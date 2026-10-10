import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { navLinks, languageLinks, renderLink } from '../scripts/links.mjs';
import { renderStatus, renderTrail } from '../scripts/motion.mjs';
import { wrapTitle, renderArticle } from '../scripts/articles.mjs';

const stats = JSON.parse(await readFile(new URL('../data/stats.json', import.meta.url), 'utf8'));
const blog = JSON.parse(await readFile(new URL('../data/blog.json', import.meta.url), 'utf8'));
const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@', parseTagValue: false });
const variants = ['light', 'dark'].flatMap((theme) => [false, true].map((mobile) => ({ theme, mobile })));
const array = (value) => value === undefined ? [] : Array.isArray(value) ? value : [value];
function elements(tree, name) {
  const found = [];
  const visit = (node) => {
    if (Array.isArray(node)) node.forEach(visit);
    else if (node && typeof node === 'object') {
      for (const [key, value] of Object.entries(node)) {
        if (key === name) found.push(...array(value));
        visit(value);
      }
    }
  };
  visit(tree);
  return found;
}
const content = (node) => typeof node === 'object' ? String(node['#text'] ?? '') : String(node);
const visibleText = (svg) => elements(parser.parse(svg), 'text').map(content);
function checkSvg(svg, expectedWidth) {
  assert.equal(XMLValidator.validate(svg), true);
  assert.doesNotMatch(svg, /NaN|Infinity|undefined|<script\b|<foreignObject\b|<image\b|\son\w+\s*=/i);
  assert.doesNotMatch(svg, /(?:href|src)\s*=\s*["'](?:https?:|data:|javascript:)|url\(\s*["']?(?:https?:|data:|javascript:)/i);
  const tree = parser.parse(svg).svg;
  assert.equal(tree['@xmlns'], 'http://www.w3.org/2000/svg');
  assert.equal(tree['@role'], 'img');
  assert.ok(tree.title && tree.desc);
  assert.ok(Number(tree['@height']) > 0);
  if (expectedWidth) assert.equal(Number(tree['@width']), expectedWidth);
  return tree;
}
function weekNodes(svg) {
  return elements(parser.parse(svg), 'rect').filter((node) => node['@data-week']).map((node) => ({
    date: node['@data-week'], count: Number(node['@data-count']), fill: node['@fill'], x: Number(node['@x']), y: Number(node['@y']),
  }));
}
const compact = (value) => value.replace(/\s+/gu, '');

test('navigation links provide the expected HTTPS destinations without sharing user input as a path', () => {
  const links = navLinks('KLucen');
  assert.deepEqual(links.map(({ id }) => id), ['blog', 'repositories', 'contributions', 'rss']);
  assert.deepEqual(links.map(({ url }) => url), [
    'https://www.klucen.cn/',
    'https://github.com/KLucen?tab=repositories',
    'https://github.com/KLucen#js-contribution-activity-description',
    'https://www.klucen.cn/rss.xml',
  ]);
  for (const item of links) assert.equal(new URL(item.url).protocol, 'https:');
  assert.equal(new URL(navLinks('name/part')[1].url).pathname, '/name%2Fpart');
  assert.deepEqual(navLinks('  '), navLinks('KLucen'));
});

test('language links use complete source bytes and encode special language names', () => {
  const fixture = { login: 'KLucen', languages: { complete: true, totalBytes: 10, totals: { 'C++': 5, 'C#': 3, 'Jupyter Notebook': 2, Empty: 0 } } };
  const links = languageLinks(fixture);
  assert.deepEqual(links.map(({ label }) => label), ['C++', 'C#', 'Jupyter Notebook']);
  assert.equal(new Set(links.map(({ id }) => id)).size, links.length);
  for (const link of links) {
    const url = new URL(link.url);
    assert.equal(url.protocol, 'https:');
    assert.equal(url.pathname, '/KLucen');
    assert.equal(url.searchParams.get('tab'), 'repositories');
    assert.equal(url.searchParams.get('type'), 'source');
    assert.equal(url.searchParams.get('language'), link.label);
    assert.ok(link.url.endsWith(encodeURIComponent(link.label)));
  }
  assert.deepEqual(languageLinks(stats).map(({ label }) => label), Object.entries(stats.languages.totals).filter(([, bytes]) => bytes > 0).sort((a, b) => b[1] - a[1]).map(([name]) => name));
});

test('incomplete, malformed, missing and zero language inventories produce no invented filters', () => {
  for (const languages of [
    undefined, { complete: false, totalBytes: 10, totals: { Python: 10 } },
    { complete: true, totalBytes: 0, totals: {} },
    { complete: true, totalBytes: 10, totals: { Python: 9 } },
    { complete: true, totalBytes: 10, totals: { Python: -1 } },
    { complete: true, totalBytes: 10, totals: { Python: NaN } },
    { complete: true, totalBytes: 10, totals: [] },
  ]) assert.deepEqual(languageLinks({ languages }), []);
});

test('navigation and language buttons embed licensed icons and show labels without percentages', () => {
  for (const link of [...navLinks(stats.login), ...languageLinks(stats)]) {
    for (const theme of ['light', 'dark']) {
      const svg = renderLink(link, theme);
      const tree = checkSvg(svg);
      assert.equal(Number(tree['@height']), 40);
      assert.ok(Number(tree['@width']) >= 110);
      assert.deepEqual(visibleText(svg), [link.label]);
      assert.doesNotMatch(visibleText(svg).join(' '), /\d+(?:\.\d+)?%/);
      assert.match(content(tree.metadata), /Lucide|ISC License|Permission to use/i);
      assert.ok(elements(tree, 'path').length > 0 || elements(tree, 'rect').length > 1);
    }
  }
});

test('button labels escape XML, preserve Unicode and reject an icon path outside the bundled icon set', () => {
  const label = 'C++ & <工具> "引号" 🚀';
  const svg = renderLink({ id: label, label, icon: '../private-icon', kind: 'language' });
  checkSvg(svg);
  assert.deepEqual(visibleText(svg), [label]);
  assert.match(svg, /&amp;|&lt;|&quot;/);
  assert.doesNotMatch(svg, /private-icon|<use\b/);
});

for (const { theme, mobile } of variants) {
  test('motion cards ' + theme + ' ' + (mobile ? 'mobile' : 'desktop') + ' have finite motion and equivalent static data', () => {
    const original = structuredClone(stats);
    const status = renderStatus(stats, theme, mobile);
    const trail = renderTrail(stats, theme, mobile);
    const staticStatus = renderStatus(stats, theme, mobile, false);
    const staticTrail = renderTrail(stats, theme, mobile, false);
    for (const svg of [status, trail, staticStatus, staticTrail]) checkSvg(svg, mobile ? 420 : 900);
    assert.deepEqual(stats, original, 'Rendering must not alter statistical data');
    assert.deepEqual(visibleText(status), visibleText(staticStatus));
    assert.deepEqual(visibleText(trail), visibleText(staticTrail));
    assert.deepEqual(weekNodes(trail), weekNodes(staticTrail));
    for (const svg of [status, trail]) {
      assert.doesNotMatch(svg, /\binfinite\b/i);
      assert.match(svg, /prefers-reduced-motion:reduce/);
      assert.match(svg, /animation:none/);
      assert.doesNotMatch(svg, /<animate\b|<animateTransform\b/);
    }
    assert.match(status, /sync-breathe 4s [^;]+ 2 forwards/);
    assert.match(trail, /trail-travel 20s linear 2 forwards/);
    for (const svg of [staticStatus, staticTrail]) assert.doesNotMatch(svg, /@keyframes|animation:/);
    const nodes = weekNodes(trail);
    assert.ok(nodes.length >= 52 && nodes.length <= 54);
    assert.equal(nodes.reduce((sum, node) => sum + node.count, 0), stats.contributions.calendar.reduce((sum, day) => sum + day.count, 0));
    assert.equal(nodes.reduce((sum, node) => sum + node.count, 0), stats.contributions.total);
    assert.equal(new Set(nodes.map(({ date }) => date)).size, nodes.length);
    for (const node of nodes) assert.equal(new Date(node.date + 'T00:00:00Z').getUTCDay(), 0);
  });
}

test('the update indicator distinguishes missing, partial and cached data and uses Beijing time', () => {
  const generatedAt = '2026-10-10T01:17:00Z';
  assert.ok(visibleText(renderStatus({ generatedAt, collection: { complete: true } })).includes('最近采集 2026-10-10 09:17 北京时间'));
  for (const fixture of [{}, { generatedAt, collection: { complete: false } }]) {
    const svg = renderStatus(fixture);
    assert.match(visibleText(svg).join(' '), /采集未完成/);
    assert.doesNotMatch(svg, /@keyframes/);
  }
  const cached = renderStatus({ generatedAt, collection: { complete: false, cacheUsed: [
    { stale: true, fetchedAt: '2026-10-09T00:01:00Z' },
    { stale: true, fetchedAt: '2026-10-08T23:01:00Z' },
    { stale: false, fetchedAt: '2026-10-01T00:00:00Z' },
  ] } });
  assert.match(visibleText(cached).join(' '), /缓存数据 2026-10-09 07:01 北京时间/);
  assert.doesNotMatch(cached, /@keyframes/);
  assert.match(content(parser.parse(cached).svg.desc), /不表示在线状态/);
});

test('weekly aggregation preserves exact UTC counts across year and leap boundaries', () => {
  const calendar = [
    { date: '2023-12-30', count: 2 }, { date: '2023-12-31', count: 3 },
    { date: '2024-01-01', count: 4 }, { date: '2024-02-29', count: 5 },
    { date: '2024-03-01', count: 6 },
  ];
  for (const mobile of [false, true]) {
    const nodes = weekNodes(renderTrail({ contributions: { calendar } }, 'light', mobile));
    assert.deepEqual(nodes.map(({ date, count }) => ({ date, count })), [
      { date: '2023-12-24', count: 2 }, { date: '2023-12-31', count: 7 }, { date: '2024-02-25', count: 11 },
    ]);
    assert.equal(nodes.reduce((sum, node) => sum + node.count, 0), 20);
  }
});

test('invalid or missing contribution dates do not yield a fabricated trail', () => {
  for (const calendar of [undefined, [], [{ date: '2026-02-30', count: 1 }], [{ date: 'invalid', count: 1 }],
    [{ date: '2026-01-01', count: -1 }], [{ date: '2026-01-01', count: NaN }],
    [{ date: '2026-01-02', count: 1 }, { date: '2026-01-01', count: 2 }],
    [{ date: '2026-01-01', count: 1 }, { date: '2026-01-01', count: 2 }],
  ]) {
    const svg = renderTrail({ contributions: { calendar } });
    checkSvg(svg);
    assert.deepEqual(weekNodes(svg), []);
    assert.match(visibleText(svg).join(' '), /N\/A.*公开贡献数据暂不可用/);
    assert.doesNotMatch(svg, /@keyframes/);
  }
});

test('a zero-contribution calendar remains zero and static with intact weekly nodes', () => {
  const calendar = stats.contributions.calendar.map((day) => ({ ...day, count: 0, level: 0 }));
  const svg = renderTrail({ contributions: { calendar, total: 0 } });
  const nodes = weekNodes(svg);
  assert.equal(nodes.length, weekNodes(renderTrail(stats)).length);
  assert.ok(nodes.every(({ count }) => count === 0));
  assert.equal(new Set(nodes.map(({ fill }) => fill)).size, 1);
  assert.doesNotMatch(svg, /@keyframes|animation:/);
  assert.match(content(parser.parse(svg).svg.desc), /合计 0 次/);
});

test('article title wrapping preserves complete Unicode, punctuation and long words', () => {
  for (const title of [
    '从 Hexo 到 Astro：迁移记录与持续探索',
    'AnExtremelyLongUnbrokenIdentifierThatMustWrapWithoutLosingCharacters'.repeat(3),
    'C++ & <工具> "引号" / 🚀 é 中文。'.repeat(8),
  ]) {
    for (const limit of [9, 20, 46]) {
      const lines = wrapTitle(title, limit);
      assert.ok(lines.length > 0 && lines.every((line) => line.length > 0));
      assert.equal(compact(lines.join('')), compact(title));
      assert.doesNotMatch(lines.join(''), /\uFFFD|[.]{3}|…/);
    }
  }
  assert.deepEqual(wrapTitle('   ', 20), ['Untitled']);
});

for (const { theme, mobile } of variants) {
  test('article cards ' + theme + ' ' + (mobile ? 'mobile' : 'desktop') + ' preserve titles and escape XML with enough vertical space', () => {
    const longTitle = 'C++ & <工具> "引号" 🚀 技术实践 / '.repeat(12);
    for (const item of [...blog.items, { title: longTitle, date: '2026-10-10T10:00:00Z' }]) {
      const svg = renderArticle(item, theme, mobile, 2);
      const tree = checkSvg(svg, mobile ? 420 : 900);
      assert.equal(content(tree.title), item.title.trim());
      const titleNodes = elements(tree, 'text').filter((node) => Number(node['@font-size']) === 18);
      assert.equal(compact(titleNodes.map(content).join('')), compact(item.title));
      assert.match(visibleText(svg).join(' '), /NOTE \/ 03/);
      assert.ok(titleNodes.every((node) => Number(node['@y']) + 26 <= Number(tree['@height']) - 22));
      assert.doesNotMatch(svg, /@keyframes|animation:/);
    }
    const missingDate = renderArticle({ title: '无日期文章' }, theme, mobile);
    assert.ok(visibleText(missingDate).includes('N/A'));
  });
}
