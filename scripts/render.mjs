import { mkdir, readFile, readdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderOverview, renderLanguages } from './cards.mjs';
import { navLinks, languageLinks, renderLink } from './links.mjs';
import { renderStatus, renderTrail } from './motion.mjs';
import { renderArticle } from './articles.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const fonts = 'font-family="Segoe UI, Noto Sans SC, Microsoft YaHei, Arial, sans-serif"';
const mono = 'font-family="Consolas, monospace"';
const themes = {
  light: { bg: '#ffffff', text: '#17212b', muted: '#576574', line: '#dce3e8', accent: '#147d66', heat: ['#edf1f4', '#b9e7cb', '#72c9a0', '#359d75', '#147d66'] },
  dark: { bg: '#11171c', text: '#edf3f7', muted: '#a3b1bd', line: '#33414d', accent: '#70dbb3', heat: ['#26313b', '#234d3c', '#327c57', '#51b982', '#7ee3ad'] },
};
export const escapeXml = (value) => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');
const fmt = (value) => Number.isFinite(value) ? new Intl.NumberFormat('en-US').format(value) : 'N/A';
const date = (value) => value?.slice(0, 10) || 'N/A';
const text = (x, y, value, size, fill, extra = '') => '<text x="' + x + '" y="' + y + '" font-size="' + size + '" fill="' + fill + '" ' + (extra.includes('font-family=') ? '' : fonts) + ' ' + extra + '>' + escapeXml(value) + '</text>';
const rect = (x, y, w, h, fill, rx = 0) => '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" rx="' + rx + '" fill="' + fill + '"/>';
const rule = (y, w, t) => '<path d="M28 ' + y + 'H' + (w - 28) + '" stroke="' + t.line + '"/>';
function shell(w, h, title, description, body, t) {
  return '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '" role="img" aria-labelledby="title desc"><title id="title">' + escapeXml(title) + '</title><desc id="desc">' + escapeXml(description) + '</desc><rect x=".5" y=".5" width="' + (w - 1) + '" height="' + (h - 1) + '" rx="8" fill="' + t.bg + '" stroke="' + t.line + '"/>' + body + '</svg>\n';
}
function titleBlock(label, title, w, t, right) {
  return text(28, 29, label, 11, t.accent, mono) + text(28, 61, title, 23, t.text, 'font-weight="600"') + text(w - 28, 29, right, 11, t.muted, mono + ' text-anchor="end"');
}
export function calendarWeeks(calendar) {
  if (!calendar?.length) return [];
  const first = new Date(calendar[0].date + 'T00:00:00Z').getUTCDay();
  const padded = [...Array(first).fill(null), ...calendar];
  while (padded.length % 7) padded.push(null);
  return Array.from({ length: padded.length / 7 }, (_, i) => padded.slice(i * 7, i * 7 + 7));
}
function calendarGrid(weeks, x, y, step, size, t) {
  let body = '', previousMonth = null, lastLabel = -100;
  for (let col = 0; col < weeks.length; col++) {
    const first = weeks[col].find(Boolean);
    const month = first?.date.slice(0, 7);
    if (month && month !== previousMonth) {
      if (col * step - lastLabel > 31) {
        const label = new Date(first.date + 'T00:00:00Z').toLocaleString('en-US', { month: 'short', timeZone: 'UTC' });
        body += text(x + col * step, y - 10, label, 10, t.muted, mono);
        lastLabel = col * step;
      }
      previousMonth = month;
    }
    for (let row = 0; row < 7; row++) {
      const day = weeks[col][row];
      if (!day) continue;
      body += '<rect x="' + (x + col * step) + '" y="' + (y + row * step) + '" width="' + size + '" height="' + size + '" rx="2" fill="' + t.heat[day.level] + '"><title>' + escapeXml(day.date) + ': ' + day.count + '</title></rect>';
    }
  }
  return body;
}
export function renderActivity(stats, theme = 'light', mobile = false) {
  const t = themes[theme], w = mobile ? 420 : 900, h = mobile ? 448 : 292;
  const activity = stats.contributions, weeks = calendarWeeks(activity.calendar);
  const isCommit = activity.kind === 'public-default-branch-commits';
  const active = activity.calendar.filter((day) => day.count > 0).length;
  let body = titleBlock('03 / ACTIVITY', fmt(activity.total) + ' 次' + (isCommit ? '默认分支提交' : '公开贡献'), w, t, '365 DAYS');
  body += text(28, 87, '自有公开非 fork 仓库 · UTC', 12, t.muted);
  if (!weeks.length) body += text(28, 151, '贡献日历暂时不可用', 15, t.muted);
  else if (mobile) {
    const half = Math.ceil(weeks.length / 2);
    body += calendarGrid(weeks.slice(0, half), 49, 123, 12, 9, t) + calendarGrid(weeks.slice(half), 49, 265, 12, 9, t);
    body += text(28, 144, 'M', 10, t.muted, mono) + text(28, 168, 'W', 10, t.muted, mono);
    body += text(28, 286, 'M', 10, t.muted, mono) + text(28, 310, 'W', 10, t.muted, mono);
  } else {
    body += calendarGrid(weeks, 62, 118, 15, 12, t);
    body += text(28, 143, 'Mon', 9, t.muted, mono) + text(28, 173, 'Wed', 9, t.muted, mono) + text(28, 203, 'Fri', 9, t.muted, mono);
  }
  const footerY = h - 54;
  body += rule(footerY - 13, w, t) + text(28, footerY + 9, (weeks.length ? active : 'N/A') + ' 个活跃日', 13, t.text);
  const legendX = w - 166;
  body += text(legendX - 33, footerY + 9, 'Less', 10, t.muted, mono);
  for (let i = 0; i < 5; i++) body += rect(legendX + i * 15, footerY, 11, 11, t.heat[i], 2);
  body += text(legendX + 79, footerY + 9, 'More', 10, t.muted, mono);
  const kinds = isCommit ? 'Default branch commits' : 'Commit / Issue / PR / Review / Repository';
  body += text(28, h - 17, date(activity.from) + ' → ' + date(activity.to) + (mobile ? '' : ' · ' + kinds), 10, t.muted, mono);
  return shell(w, h, '近365天公开贡献日历', '范围 ' + date(activity.from) + ' 至 ' + date(activity.to) + '，贡献 ' + fmt(activity.total) + '，活跃日 ' + (weeks.length ? active : 'N/A') + '。' + (activity.scope || activity.sourceReason), body, t);
}
export function renderBlog(blog, theme = 'light', mobile = false) {
  const t = themes[theme], w = mobile ? 420 : 900, h = mobile ? 238 : 186;
  let body = titleBlock('04 / NOTEBOOK', 'KLucenの启示录', w, t, blog.complete ? 'RSS' : 'CACHED / N/A');
  body += text(28, 89, 'klucen.cn · 学习记录、技术实践与日常', 13, t.muted);
  const x = mobile ? 28 : 535, y = mobile ? 113 : 58;
  body += text(x, y + 33, fmt(blog.itemCount), 34, t.text, 'font-weight="600"') + text(x, y + 56, 'RSS 收录条目', 12, t.muted);
  const secondX = x + (mobile ? 184 : 166);
  body += text(secondX, y + 32, date(blog.latestDate), mobile ? 20 : 22, t.text, mono + ' font-weight="600"') + text(secondX, y + 56, '最近发布', 12, t.muted);
  body += rule(h - 39, w, t) + text(28, h - 16, 'RSS 覆盖范围 · 数据更新 ' + date(blog.generatedAt), 11, t.muted);
  return shell(w, h, '博客统计', (blog.title || '博客') + '，RSS收录 ' + fmt(blog.itemCount) + ' 个条目，最近发布 ' + date(blog.latestDate) + '。' + blog.sourceReason, body, t);
}
export function picture(name, alt, reducedMotion = false) {
  const sources = reducedMotion ? [
    '  <source media="(prefers-reduced-motion: reduce) and (prefers-color-scheme: dark) and (max-width: 600px)" srcset="./assets/' + name + '-static-mobile-dark.svg">',
    '  <source media="(prefers-reduced-motion: reduce) and (max-width: 600px)" srcset="./assets/' + name + '-static-mobile-light.svg">',
    '  <source media="(prefers-reduced-motion: reduce) and (prefers-color-scheme: dark)" srcset="./assets/' + name + '-static-dark.svg">',
    '  <source media="(prefers-reduced-motion: reduce)" srcset="./assets/' + name + '-static-light.svg">',
  ] : [];
  return ['<picture>', ...sources, '  <source media="(prefers-color-scheme: dark) and (max-width: 600px)" srcset="./assets/' + name + '-mobile-dark.svg">', '  <source media="(max-width: 600px)" srcset="./assets/' + name + '-mobile-light.svg">', '  <source media="(prefers-color-scheme: dark)" srcset="./assets/' + name + '-dark.svg">', '  <img src="./assets/' + name + '-light.svg" alt="' + escapeXml(alt) + '" width="900">', '</picture>'].join('\n');
}
const linked = (url, content, title) => '<a href="' + escapeXml(url) + '"' + (title ? ' title="' + escapeXml(title) + '"' : '') + '>\n' + content + '\n</a>';
function button(link) {
  const name = 'link-' + link.id;
  const width = renderLink(link).match(/<svg[^>]* width="(\d+)"/)[1];
  return '<a href="' + escapeXml(link.url) + '" title="' + escapeXml(link.label) + '"><picture><source media="(prefers-color-scheme: dark)" srcset="./assets/' + name + '-dark.svg"><img src="./assets/' + name + '-light.svg" alt="' + escapeXml(link.label) + '" width="' + width + '" height="40"></picture></a>';
}
export function renderReadme(stats, blog) {
  const posts = blog.items.slice(0, 3).map((item, i) => linked(item.url, picture('article-' + (i + 1), item.title + ' · ' + date(item.date)), '阅读文章：' + item.title)).join('\n\n');
  const fallback = stats.commits.metric === 'default-branch-authored-commits';
  const nav = navLinks(stats.login);
  const contributions = nav.find((link) => link.id === 'contributions').url;
  const repositories = nav.find((link) => link.id === 'repositories').url;
  const workflow = 'https://github.com/' + encodeURIComponent(stats.login || 'KLucen') + '/KLucen/actions/workflows/update-profile.yml';
  return [
    '<!-- Generated by scripts/render.mjs. Edit that file to change the profile. -->', '# KLucen', '',
    'AI 学习者，喜欢写代码，也喜欢把实践和思考留在博客里。', '',
    '<p>' + nav.map(button).join('\n') + '</p>', '',
    linked(workflow, picture('status', '每日北京时间 09:17 自动更新；点击查看更新记录', true), '查看自动更新记录'), '',
    linked(contributions, picture('overview', '近365天' + fmt(stats.commits.count) + (fallback ? '次默认分支提交' : '次 Commit 贡献') + '，' + fmt(stats.profile.publicRepos) + '个自有公开非fork仓库，' + fmt(stats.profile.stars) + '个 Stars'), '查看 GitHub 贡献'), '',
    linked(repositories, picture('languages', '自有公开非fork仓库的代码语言占比，按GitHub Linguist代码字节计算'), '浏览公开仓库'), '',
    '<p>' + languageLinks(stats).map(button).join('\n') + '</p>', '',
    linked(contributions, picture('activity', '近365天' + fmt(stats.contributions.total) + '次' + (fallback ? '默认分支提交' : '公开贡献') + '日历，自有公开非fork仓库范围'), '查看贡献记录'), '',
    linked(contributions, picture('trail', '每周贡献轨迹；装饰像素巡游播放两轮后停止', true), '查看贡献记录'), '',
    linked('https://www.klucen.cn/', picture('blog', '博客RSS收录' + fmt(blog.itemCount) + '个条目，最近发布' + date(blog.latestDate)), '打开博客'), '',
    '### 最近写下的', '', posts || 'RSS 暂时不可用，请访问[博客](https://www.klucen.cn/)。', '',
    '<details>', '<summary>正在探索的项目</summary>', '',
    '- AI 与学习笔记：[ai-agent-book-note](https://github.com/KLucen/ai-agent-book-note)',
    '- Markdown 阅读与批注：[MerMarkd](https://github.com/KLucen/MerMarked)',
    '- 博客与前端实践：[shirone-blog](https://github.com/KLucen/shirone-blog)', '', '</details>', '',
    '<details>', '<summary>数据口径与更新</summary>', '',
    '数据更新时间：' + date(stats.generatedAt) + '（UTC）。卡片由本仓库每日自动生成，无需第三方统计卡片服务。', '',
    '- 范围为自有公开非 fork 仓库，包含归档仓库；私有仓库和其他人的仓库不计入。',
    '- Commit 统计区间：' + date(stats.commits.from) + ' 至 ' + date(stats.commits.to) + '，' + (fallback ? '当前为 REST 降级统计：只计算默认分支 authored commits。' : '遵循 GitHub Commit 贡献的资格规则。'),
    '- ' + (fallback ? '当前日历仅统计默认分支 authored commits，不等于 GitHub 全主页贡献数。' : '贡献日历包含 Commit、Issue、PR、Review 和创建仓库，因此不等于 Commit 数，也不等于 GitHub 全主页贡献数。'),
    '- 语言比例来自 GitHub Linguist 识别的代码字节；包含历史静态博客与仓库中的依赖代码，不代表熟练度，也不代表框架使用次数。语言按钮按 GitHub 仓库的主要语言筛选，不等于该语言存在的全部仓库。',
    '- 博客数量为 RSS 中的条目数，未声称覆盖全部文章。',
    '- 状态点表示自动更新计划，不表示在线。像素巡游仅为装饰，播放两轮后停止；系统减少动效模式使用静态图片。',
    '- 采集失败时会显示缓存或缺失状态。更新方式见 [维护说明](./DEVELOPMENT.md)。', '', '</details>', '',
  ].join('\n');
}
export async function generate() {
  const stats = JSON.parse(await readFile(path.join(root, 'data/stats.json'), 'utf8'));
  const blog = JSON.parse(await readFile(path.join(root, 'data/blog.json'), 'utf8'));
  await mkdir(path.join(root, 'assets'), { recursive: true });
  const generated = new Set();
  const cards = [['overview', renderOverview, stats], ['languages', renderLanguages, stats], ['activity', renderActivity, stats], ['blog', renderBlog, blog],
    ['status', renderStatus, stats], ['trail', renderTrail, stats],
    ['status-static', (data, theme, mobile) => renderStatus(data, theme, mobile, false), stats],
    ['trail-static', (data, theme, mobile) => renderTrail(data, theme, mobile, false), stats],
    ...blog.items.slice(0, 3).map((item, i) => ['article-' + (i + 1), (data, theme, mobile) => renderArticle(data, theme, mobile, i), item]),
  ];
  for (const [name, renderer, data] of cards) {
    for (const theme of Object.keys(themes)) {
      for (const mobile of [false, true]) {
        const filename = name + (mobile ? '-mobile' : '') + '-' + theme + '.svg';
        await writeFile(path.join(root, 'assets', filename), renderer(data, theme, mobile), 'utf8');
        generated.add(filename);
      }
    }
  }
  const links = [...navLinks(stats.login), ...languageLinks(stats)];
  for (const link of links) {
    for (const theme of Object.keys(themes)) {
      const filename = 'link-' + link.id + '-' + theme + '.svg';
      await writeFile(path.join(root, 'assets', filename), renderLink(link, theme), 'utf8');
      generated.add(filename);
    }
  }
  await writeFile(path.join(root, 'README.md'), renderReadme(stats, blog), 'utf8');
  const managed = /^(?:(?:overview|languages|activity|blog|status(?:-static)?|trail(?:-static)?|article-\d+)(?:-mobile)?|link-(?:blog|repositories|contributions|rss|language-[a-f0-9]+))-(?:light|dark)\.svg$/;
  for (const entry of await readdir(path.join(root, 'assets'), { withFileTypes: true })) {
    if (entry.isFile() && managed.test(entry.name) && !generated.has(entry.name)) await unlink(path.join(root, 'assets', entry.name));
  }
  console.log('Generated README.md and ' + (cards.length * 4 + links.length * 2) + ' self-contained SVG images.');
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await generate();
