import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { renderOverview, renderLanguages } from '../scripts/cards.mjs';
import { calendarWeeks, renderActivity, renderBlog, renderReadme } from '../scripts/render.mjs';

const stats = JSON.parse(await readFile(new URL('../data/stats.json', import.meta.url), 'utf8'));
const blog = JSON.parse(await readFile(new URL('../data/blog.json', import.meta.url), 'utf8'));
const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@', parseTagValue: false });
const variants = ['light', 'dark'].flatMap((theme) => [false, true].map((mobile) => ({ theme, mobile })));
const cards = [
  ['overview', renderOverview, stats],
  ['languages', renderLanguages, stats],
  ['activity', renderActivity, stats],
  ['blog', renderBlog, blog],
];
const format = (value) => new Intl.NumberFormat('en-US').format(value);
const flatText = (xml) => {
  const strings = [];
  const visit = (node, key = '') => {
    if (Array.isArray(node)) node.forEach((item) => visit(item, key));
    else if (node && typeof node === 'object') Object.entries(node).forEach(([name, item]) => visit(item, name));
    else if (!key.startsWith('@')) strings.push(String(node));
  };
  visit(parser.parse(xml));
  return strings.join(' ');
};

function checkSvg(svg, mobile) {
  assert.equal(XMLValidator.validate(svg), true, 'The generated image must be valid XML');
  assert.doesNotMatch(svg, /NaN|Infinity|undefined|<script\b|<foreignObject\b|<image\b|\son\w+\s*=/i);
  assert.doesNotMatch(svg, /(?:href|src)\s*=\s*["'](?:https?:|data:|javascript:)|url\(\s*["']?(?:https?:|data:|javascript:)/i);
  const tree = parser.parse(svg).svg;
  assert.equal(tree['@xmlns'], 'http://www.w3.org/2000/svg');
  assert.equal(tree['@role'], 'img');
  assert.equal(Number(tree['@width']), mobile ? 420 : 900);
  assert.ok(Number(tree['@height']) > 0);
  assert.ok(flatText(svg).length > 30, 'The image needs accessible text as well as shapes');
  assert.ok(tree.title && tree.desc, 'SVG title and description are required');
  const numericAttributes = new Set(['@x', '@y', '@width', '@height', '@cx', '@cy', '@r', '@rx', '@ry', '@stroke-width', '@font-size']);
  const visit = (node) => {
    if (Array.isArray(node)) node.forEach(visit);
    else if (node && typeof node === 'object') {
      for (const [name, value] of Object.entries(node)) {
        if (numericAttributes.has(name)) assert.ok(Number.isFinite(Number(value)), name + ' must be finite');
        else visit(value);
      }
    }
  };
  visit(tree);
  return tree;
}

for (const [name, renderer, data] of cards) {
  for (const { theme, mobile } of variants) {
    test(name + ' ' + theme + ' ' + (mobile ? 'mobile' : 'desktop') + ' is an accessible, self-contained SVG', () => {
      checkSvg(renderer(data, theme, mobile), mobile);
    });
  }
}

test('the calendar has one cell per date, uses Sunday rows, and preserves counts across year and leap boundaries', () => {
  const synthetic = Array.from({ length: 365 }, (_, i) => ({
    date: new Date(Date.UTC(2023, 9, 3 + i)).toISOString().slice(0, 10), count: i % 5, level: i % 5,
  }));
  for (const calendar of [synthetic, stats.contributions.calendar].filter((days) => days.length)) {
    assert.equal(calendar.length, 365);
    const weeks = calendarWeeks(calendar);
    assert.ok(weeks.every((week) => week.length === 7));
    const days = weeks.flat().filter(Boolean);
    assert.deepEqual(days, calendar);
    assert.equal(new Set(days.map(({ date }) => date)).size, calendar.length);
    assert.equal(days.reduce((sum, day) => sum + day.count, 0), calendar.reduce((sum, day) => sum + day.count, 0));
    for (const week of weeks) {
      week.forEach((day, row) => {
        if (day) assert.equal(new Date(day.date + 'T00:00:00Z').getUTCDay(), row);
      });
    }
    for (let i = 1; i < days.length; i++) {
      assert.equal(Date.parse(days[i].date) - Date.parse(days[i - 1].date), 86_400_000);
    }
  }
  assert.ok(synthetic.some(({ date }) => date === '2024-02-29'));
  assert.deepEqual(calendarWeeks([]), []);
});

test('real contribution totals equal the source calendar and remain distinct from commits', () => {
  const activity = stats.contributions;
  if (activity.calendar.length) {
    assert.equal(activity.calendar[0].date, activity.from.slice(0, 10));
    assert.equal(activity.calendar.at(-1).date, activity.to.slice(0, 10));
    assert.equal(activity.calendar.reduce((sum, day) => sum + day.count, 0), activity.total);
    for (const day of activity.calendar) {
      assert.ok(Number.isInteger(day.count) && day.count >= 0);
      assert.ok(Number.isInteger(day.level) && day.level >= 0 && day.level <= 4);
      assert.equal(day.count === 0, day.level === 0);
    }
  }
  if (activity.counts) {
    assert.equal(Object.values(activity.counts).reduce((sum, count) => sum + count, 0), activity.total);
    assert.equal(activity.counts.commits, stats.commits.count);
  }
  const xml = renderActivity(stats);
  const labels = [...xml.matchAll(/<title>(\d{4}-\d{2}-\d{2}): (\d+)<\/title>/g)];
  assert.deepEqual(labels.map(([, date, count]) => ({ date, count: Number(count) })), activity.calendar.map(({ date, count }) => ({ date, count })));
});

test('language bytes and rounded percentages agree with public non-fork repository data', () => {
  const totals = {};
  for (const repo of stats.repositories.filter(({ fork }) => !fork)) {
    for (const [language, bytes] of Object.entries(repo.languages)) totals[language] = (totals[language] || 0) + bytes;
  }
  assert.deepEqual(totals, stats.languages.totals);
  const total = Object.values(totals).reduce((sum, bytes) => sum + bytes, 0);
  assert.equal(total, stats.languages.totalBytes);
  if (total > 0) {
    for (const [language, bytes] of Object.entries(totals)) {
      assert.ok(Math.abs(stats.languages.percentages[language] - bytes / total * 100) <= 0.00005 + Number.EPSILON);
    }
    assert.ok(Math.abs(Object.values(stats.languages.percentages).reduce((sum, value) => sum + value, 0) - 100) < 0.001);
  }
});

test('language chart arc lengths use exact code-byte ratios without decorative minimum slices', () => {
  const data = structuredClone(stats);
  data.languages.percentages = Object.fromEntries(Object.keys(data.languages.totals).map((name) => [name, 99]));
  const expected = Object.entries(data.languages.totals).filter(([, bytes]) => bytes > 0).sort((a, b) => b[1] - a[1]);
  for (const { theme, mobile } of variants) {
    const tree = checkSvg(renderLanguages(data, theme, mobile), mobile);
    const segments = tree.g.circle.filter((circle) => circle['@stroke-dasharray']);
    assert.equal(segments.length, expected.length);
    let arcSum = 0;
    segments.forEach((segment, index) => {
      const [arc, gap] = segment['@stroke-dasharray'].split(/\s+/).map(Number);
      const circumference = 2 * Math.PI * Number(segment['@r']);
      assert.ok(Math.abs(arc + gap - circumference) < 0.000002);
      assert.ok(Math.abs(arc / circumference - expected[index][1] / data.languages.totalBytes) < 0.00000001);
      assert.ok(Math.abs(Number(segment['@stroke-dashoffset']) + arcSum) < 0.000002);
      arcSum += arc;
    });
    assert.ok(Math.abs(arcSum - 2 * Math.PI * Number(segments[0]['@r'])) < 0.00001);
  }
});

test('small languages remain true proportions and only aggregate the remaining languages as Other', () => {
  const data = structuredClone(stats);
  data.languages = { complete: true, totalBytes: 1_000_066, totals: { Main: 1_000_000, ...Object.fromEntries(Array.from({ length: 11 }, (_, i) => ['Tiny' + i, 11 - i])) } };
  const tree = checkSvg(renderLanguages(data), false);
  const segments = tree.g.circle.filter((circle) => circle['@stroke-dasharray']);
  assert.equal(segments.length, 10);
  const circumference = 2 * Math.PI * Number(segments[0]['@r']);
  assert.ok(Number(segments[0]['@stroke-dasharray'].split(' ')[0]) / circumference > 0.9999);
  const lastArc = Number(segments.at(-1)['@stroke-dasharray'].split(' ')[0]);
  assert.ok(Math.abs(lastArc / circumference - 6 / data.languages.totalBytes) < 0.00000001);
  assert.match(flatText(renderLanguages(data)), /Other/);
  assert.match(flatText(renderLanguages(data)), /<0\.1%/);
});

test('README picture sources select all local theme and size variants and carry metric-specific fallback text', () => {
  for (const fallback of [false, true]) {
    const data = structuredClone(stats);
    data.commits.metric = fallback ? 'default-branch-authored-commits' : 'commit-contributions';
    data.contributions.kind = fallback ? 'public-default-branch-commits' : 'public-contributions';
    const readme = renderReadme(data, blog);
    for (const [name] of cards) {
      for (const suffix of ['mobile-dark', 'mobile-light', 'dark', 'light']) {
        assert.equal(readme.split('./assets/' + name + '-' + suffix + '.svg').length - 1, 1);
      }
    }
    const images = [...readme.matchAll(/<img src="([^"]+)" alt="([^"]+)" width="900">/g)];
    assert.equal(images.filter(([, source]) => /\/(overview|languages|activity|blog)-light\.svg$/.test(source)).length, 4);
    const overview = images.find(([, source]) => source.includes('overview'))[2];
    const activity = images.find(([, source]) => source.includes('activity'))[2];
    assert.ok(overview.includes(format(data.commits.count)));
    assert.ok(overview.includes(format(data.profile.publicRepos)));
    assert.ok(activity.includes(format(data.contributions.total)));
    assert.match(overview, fallback ? /默认分支提交/ : /Commit 贡献/);
    assert.match(activity, fallback ? /默认分支提交/ : /公开贡献/);
    assert.match(readme, /代码字节/);
    assert.match(readme, /RSS/);
    assert.doesNotMatch(readme, /card-motion|card-stage|card-frames/);
  }
});

test('README links navigation, statistics, language filters and articles with static sources before animated images', () => {
  const readme = renderReadme(stats, blog);
  assert.doesNotMatch(readme, /<script\b|<style\b|\son\w+\s*=/i);
  assert.match(readme, /title="查看自动更新记录"/);
  assert.match(readme, /language=Jupyter%20Notebook/);
  assert.match(readme, /#js-contribution-activity-description/);
  for (const name of ['status', 'trail']) {
    const position = readme.indexOf('./assets/' + name + '-static-mobile-dark.svg');
    assert.ok(position >= 0 && position < readme.indexOf('./assets/' + name + '-mobile-dark.svg'));
    assert.match(readme, /prefers-reduced-motion: reduce/);
  }
  for (const [i, post] of blog.items.slice(0, 3).entries()) {
    assert.ok(readme.includes(post.url));
    assert.ok(readme.includes('article-' + (i + 1) + '-light.svg'));
  }
  assert.equal([...readme.matchAll(/<details>/g)].length, 2);
});

test('missing blog and activity values show unavailable data without invented zero totals', () => {
  const data = structuredClone(stats);
  data.contributions.total = null;
  data.contributions.calendar = [];
  data.contributions.sourceReason = 'No cached public contribution data';
  const missingBlog = { ...structuredClone(blog), itemCount: null, latestDate: null, items: [], complete: false, sourceReason: 'No cached RSS data' };
  for (const { theme, mobile } of variants) {
    const activity = renderActivity(data, theme, mobile);
    const notebook = renderBlog(missingBlog, theme, mobile);
    checkSvg(activity, mobile);
    checkSvg(notebook, mobile);
    assert.match(flatText(activity), /N\/A/);
    assert.match(flatText(notebook), /N\/A/);
    assert.doesNotMatch(activity, /<title>\d{4}-\d{2}-\d{2}:/);
    assert.doesNotMatch(flatText(activity), /0 次|0 个活跃日/);
    assert.doesNotMatch(flatText(notebook), /RSS收录 0 个条目/);
  }
});

test('missing overview metrics and incomplete language data never fabricate a zero or a colored sector', () => {
  const data = structuredClone(stats);
  data.commits.count = null;
  data.profile = { ...data.profile, publicRepos: null, stars: null, followers: null };
  data.languages = { ...data.languages, complete: false, totalBytes: null, totals: {}, percentages: {} };
  for (const { theme, mobile } of variants) {
    const overview = renderOverview(data, theme, mobile);
    const languages = renderLanguages(data, theme, mobile);
    checkSvg(overview, mobile);
    checkSvg(languages, mobile);
    assert.match(flatText(overview), /Commit 贡献 N\/A/);
    assert.match(flatText(overview), /公开仓库 N\/A/);
    assert.match(flatText(overview), /Stars N\/A/);
    assert.match(flatText(languages), /N\/A/);
    assert.doesNotMatch(languages, /stroke-dasharray/);
    assert.doesNotMatch(flatText(languages), /[0-9]+(?:\.[0-9]+)?%/);
  }
});

test('zero code-byte collections draw an empty chart rather than invented proportions', () => {
  const data = structuredClone(stats);
  data.languages = { complete: true, totalBytes: 0, totals: {}, percentages: {} };
  for (const { theme, mobile } of variants) {
    const languages = renderLanguages(data, theme, mobile);
    checkSvg(languages, mobile);
    assert.match(flatText(languages), /总计 0 bytes/);
    assert.doesNotMatch(languages, /stroke-dasharray/);
    assert.doesNotMatch(flatText(languages), /[0-9]+(?:\.[0-9]+)?%/);
  }
});

test('valid zero counts stay numeric and a zero calendar retains all 365 days', () => {
  const data = structuredClone(stats);
  data.commits.count = 0;
  data.profile.publicRepos = 0;
  data.profile.stars = 0;
  data.profile.followers = 0;
  data.contributions.total = 0;
  data.contributions.calendar = data.contributions.calendar.map((day) => ({ ...day, count: 0, level: 0 }));
  const emptyBlog = { ...blog, itemCount: 0, latestDate: null, items: [] };
  for (const { theme, mobile } of variants) {
    const overview = renderOverview(data, theme, mobile);
    const activity = renderActivity(data, theme, mobile);
    const notebook = renderBlog(emptyBlog, theme, mobile);
    checkSvg(overview, mobile);
    checkSvg(activity, mobile);
    checkSvg(notebook, mobile);
    assert.match(flatText(overview), /\b0\b/);
    assert.match(flatText(activity), /0 次/);
    assert.match(flatText(activity), /0 个活跃日/);
    assert.match(flatText(notebook), /RSS收录 0 个条目/);
    assert.equal([...activity.matchAll(/<title>\d{4}-\d{2}-\d{2}: 0<\/title>/g)].length, data.contributions.calendar.length);
  }
});

test('stale cache states retain the oldest original timestamp instead of presenting the latest collection attempt as an update', () => {
  const data = structuredClone(stats);
  data.generatedAt = '2030-12-31T22:13:00.000Z';
  data.collection = { complete: false, cacheUsed: [
    { scope: 'profile', stale: true, fetchedAt: '2026-10-09T13:00:00.000Z' },
    { scope: 'languages', stale: true, fetchedAt: '2026-10-08T15:20:00+08:00' },
    { scope: 'commits', stale: false, fetchedAt: '2020-01-01T00:00:00.000Z' },
  ] };
  for (const renderer of [renderOverview, renderLanguages]) {
    for (const { theme, mobile } of variants) {
      const tree = checkSvg(renderer(data, theme, mobile), mobile);
      const visible = tree.g.text.map((node) => node['#text'] || node).join(' ');
      assert.match(visible, /CACHED/);
      assert.doesNotMatch(visible, /PARTIAL|更新于 2030-12-31/);
      assert.match(tree.desc['#text'], /缓存原时间 2026-10-08 07:20 UTC/);
      assert.match(tree.desc['#text'], /采集尝试 2030-12-31 22:13 UTC/);
      if (renderer === renderOverview) {
        assert.match(visible, /缓存 2026-10-08 07:20 UTC/);
        assert.doesNotMatch(visible, /2030-12-31/);
      }
    }
  }
});

test('an incomplete collection without stale cache visibly reports PARTIAL and labels its time as an attempt', () => {
  const data = structuredClone(stats);
  data.generatedAt = '2030-12-31T22:13:00.000Z';
  data.collection = { complete: false, cacheUsed: [{ scope: 'profile', stale: false, fetchedAt: '2020-01-01T00:00:00.000Z' }] };
  for (const renderer of [renderOverview, renderLanguages]) {
    for (const { theme, mobile } of variants) {
      const tree = checkSvg(renderer(data, theme, mobile), mobile);
      const visible = tree.g.text.map((node) => node['#text'] || node).join(' ');
      assert.match(visible, /PARTIAL/);
      assert.doesNotMatch(visible, /CACHED|更新于/);
      assert.match(tree.desc['#text'], /采集尚不完整/);
      assert.match(tree.desc['#text'], /采集尝试 2030-12-31 22:13 UTC/);
      if (renderer === renderOverview) assert.match(visible, /采集尝试 2030-12-31 22:13 UTC/);
    }
  }
});

test('missing collection metadata remains compatible and fresh cache does not claim to be stale', () => {
  for (const collection of [undefined, { complete: true, cacheUsed: [] }, { complete: true, cacheUsed: [{ stale: false, fetchedAt: '2020-01-01T00:00:00.000Z' }] }]) {
    const data = structuredClone(stats);
    if (collection) data.collection = collection;
    else delete data.collection;
    for (const renderer of [renderOverview, renderLanguages]) {
      for (const { theme, mobile } of variants) {
        const xml = renderer(data, theme, mobile);
        checkSvg(xml, mobile);
        assert.match(flatText(xml), /PUBLIC DATA/);
        assert.doesNotMatch(flatText(xml), /CACHED|PARTIAL|缓存原时间|2020-01-01/);
      }
    }
  }
});

test('default-branch fallback remains correctly labeled when statistics are cached', () => {
  const data = structuredClone(stats);
  data.commits.metric = 'default-branch-authored-commits';
  data.collection = { complete: false, cacheUsed: [{ scope: 'commits', stale: true, fetchedAt: '2026-10-08T07:20:00.000Z' }] };
  for (const { theme, mobile } of variants) {
    const xml = renderOverview(data, theme, mobile);
    checkSvg(xml, mobile);
    assert.match(flatText(xml), /CACHED/);
    assert.match(flatText(xml), /默认分支 Commit/);
    assert.doesNotMatch(flatText(xml), /Commit 贡献/);
  }
});
