const FONT = 'Segoe UI, Noto Sans SC, Microsoft YaHei, Arial, sans-serif';
const THEMES = {
  light: { background: '#ffffff', text: '#202b34', muted: '#61717e', line: '#dce4e9', accent: '#188360' },
  dark: { background: '#11171c', text: '#edf3f7', muted: '#a3b1bd', line: '#33414d', accent: '#70dbb3' },
};
const COLORS = {
  HTML: '#ed7250', TypeScript: '#438dde', Python: '#e5b947', JavaScript: '#cdb631',
  Svelte: '#f27857', CSS: '#9b79da', Astro: '#db638d', 'Jupyter Notebook': '#c58b42', Stylus: '#73a663',
};
const FALLBACK = ['#5d9ca3', '#be7c98', '#7fa16d', '#d28d55', '#8394bc', '#a784ad', '#759fa0', '#b7a764', '#b58268', '#87949e'];
const number = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const escape = (value) => String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[character]));
export const count = (value) => number(value) ? Math.trunc(value).toLocaleString('en-US') : 'N/A';
const decimal = (value) => Number(value.toFixed(6));
function date(value, includeTime = false) {
  const parsed = typeof value === 'string' ? new Date(value) : null;
  if (!parsed || !Number.isFinite(parsed.getTime())) return 'N/A';
  return includeTime ? parsed.toISOString().slice(0, 10) + ' ' + parsed.toISOString().slice(11, 16) : parsed.toISOString().slice(0, 10);
}
function text(value, x, y, size, color, extra = '') {
  return '<text x="' + x + '" y="' + y + '" font-size="' + size + '" fill="' + color + '"' + (extra ? ' ' + extra : '') + '>' + escape(value) + '</text>';
}
function line(d, color) { return '<path d="' + d + '" fill="none" stroke="' + color + '"/>'; }
function circle(x, y, r, color, extra = '') {
  return '<circle cx="' + x + '" cy="' + y + '" r="' + r + '" ' + extra + ' fill="' + color + '"/>';
}
function svg(id, width, height, theme, title, description, content) {
  const palette = THEMES[theme] || THEMES.light;
  return '<svg xmlns="http://www.w3.org/2000/svg" width="' + width + '" height="' + height + '" viewBox="0 0 ' + width + ' ' + height + '" role="img" aria-labelledby="' + id + '-title ' + id + '-desc"><title id="' + id + '-title">' + escape(title) + '</title><desc id="' + id + '-desc">' + escape(description) + '</desc><rect x="0.5" y="0.5" width="' + (width - 1) + '" height="' + (height - 1) + '" rx="8" fill="' + palette.background + '" stroke="' + palette.line + '"/><g font-family="' + FONT + '">' + content + '</g></svg>\n';
}
function header(eyebrow, title, palette, mobile) {
  return text(eyebrow, 28, 29, 11, palette.accent, 'font-weight="700"') + text(title, 28, mobile ? 63 : 66, mobile ? 24 : 27, palette.text, 'font-weight="700"');
}
function collectionStatus(stats) {
  const stale = Array.isArray(stats?.collection?.cacheUsed) ? stats.collection.cacheUsed.filter((item) => item?.stale === true) : [];
  const dates = stale.map((item) => item.fetchedAt).filter((value) => typeof value === 'string' && Number.isFinite(Date.parse(value))).sort((a, b) => Date.parse(a) - Date.parse(b));
  const label = stale.length ? 'CACHED' : stats?.collection?.complete === false ? 'PARTIAL' : 'PUBLIC DATA';
  return { label, cachedAt: dates[0] || null, attemptedAt: date(stats?.generatedAt, true) };
}
function statusDescription(status) {
  if (status.label === 'CACHED') return '数据状态 CACHED；缓存原时间 ' + date(status.cachedAt, true) + ' UTC；采集尝试 ' + status.attemptedAt + ' UTC。';
  if (status.label === 'PARTIAL') return '数据状态 PARTIAL；采集尚不完整；采集尝试 ' + status.attemptedAt + ' UTC。';
  return '数据状态 PUBLIC DATA；更新 ' + status.attemptedAt + ' UTC。';
}
function languageData(stats) {
  const source = stats?.languages;
  if (source?.complete !== true || !number(source.totalBytes) || !source.totals || typeof source.totals !== 'object' || Array.isArray(source.totals)) return null;
  const entries = Object.entries(source.totals);
  if (entries.some(([name, bytes]) => !name || !number(bytes))) return null;
  const languages = entries.filter(([, bytes]) => bytes > 0).sort((a, b) => b[1] - a[1]);
  if (languages.reduce((sum, [, bytes]) => sum + bytes, 0) !== source.totalBytes) return null;
  return { totalBytes: source.totalBytes, languages };
}

// The language legend is a fixed 2x5 grid, so at most 10 entries fit. Beyond
// that the smallest languages are aggregated into one "Other" slice. Exported so
// tests exercise this rule instead of restating it and drifting out of sync.
export function collapseLanguages(languages) {
  if (languages.length <= 10) return languages;
  const rest = languages.slice(9).reduce((sum, [, bytes]) => sum + bytes, 0);
  return [...languages.slice(0, 9), ['Other', rest]];
}

export function renderOverview(stats, theme = 'light', mobile = false) {
  theme = theme === 'dark' ? 'dark' : 'light';
  const palette = THEMES[theme] || THEMES.light;
  const width = mobile ? 420 : 900;
  const height = mobile ? 390 : 228;
  const languages = languageData(stats);
  const status = collectionStatus(stats);
  const fallback = stats?.commits?.metric === 'default-branch-authored-commits';
  const metrics = [
    { value: stats?.commits?.count, label: fallback ? '默认分支 Commit' : 'Commit 贡献', note: '过去 365 个 UTC 日期', color: palette.accent },
    { value: stats?.profile?.publicRepos, label: '公开仓库', note: '自有仓库 · 排除 fork', color: palette.text },
    { value: stats?.profile?.stars, label: 'Stars', note: '公开非 fork 仓库合计', color: palette.text },
    { value: languages?.languages.length, label: '代码语言', note: 'GitHub Linguist', color: palette.text },
  ];
  let content = header('01 / GITHUB', '把想法写进代码里', palette, mobile);
  content += text(status.label, width - 28, 29, 10, palette.muted, 'font-weight="600" text-anchor="end"');
  content += line(mobile ? 'M210 91V305 M28 198H392' : 'M239 94V177 M450 94V177 M661 94V177', palette.line);
  metrics.forEach((metric, index) => {
    const x = mobile ? (index % 2 ? 236 : 28) : 28 + index * 211;
    const y = mobile ? 127 + Math.floor(index / 2) * 110 : 130;
    const value = count(metric.value);
    const valueSize = Math.min(mobile ? 34 : 37, (mobile ? 156 : 180) / Math.max(1, value.length * 0.62));
    content += text(value, x, y, valueSize, metric.color, 'font-weight="700"');
    content += text(metric.label, x, y + 26, 14, palette.text, 'font-weight="600"');
    content += text(metric.note, x, y + 46, 11, palette.muted);
  });
  const range = date(stats?.commits?.from) + ' → ' + date(stats?.commits?.to);
  const updated = date(stats?.generatedAt, true);
  const timestamp = status.label === 'CACHED' ? '缓存 ' + date(status.cachedAt, true) + ' UTC' : (status.label === 'PARTIAL' ? '采集尝试 ' : '更新于 ') + updated + ' UTC';
  if (mobile) {
    content += line('M28 322H392', palette.line);
    content += text('UTC 范围 ' + range, 28, 345, 11, palette.muted);
    content += text(timestamp, 28, 368, 11, palette.muted);
  } else {
    content += line('M28 187H872', palette.line);
    content += text('UTC 范围 ' + range, 28, 211, 11, palette.muted);
    content += text(timestamp, 872, 211, 11, palette.muted, 'text-anchor="end"');
  }
  const description = (stats?.login || 'GitHub') + ' 的公开数据。' + metrics.map((metric) => metric.label + ' ' + count(metric.value)).join('，') + '。自有公开非 fork 仓库，含归档；日期范围 ' + range + ' UTC。' + statusDescription(status);
  return svg('overview-' + theme + '-' + (mobile ? 'mobile' : 'desktop'), width, height, theme, 'GitHub 数据概览：把想法写进代码里', description, content);
}

export function renderLanguages(stats, theme = 'light', mobile = false) {
  theme = theme === 'dark' ? 'dark' : 'light';
  const palette = THEMES[theme] || THEMES.light;
  const width = mobile ? 420 : 900;
  const height = mobile ? 620 : 334;
  const data = languageData(stats);
  const status = collectionStatus(stats);
  const centerX = mobile ? 210 : 168;
  const centerY = mobile ? 180 : 178;
  const radius = mobile ? 79 : 80;
  const circumference = 2 * Math.PI * radius;
  let content = header('02 / CODE COMPOSITION', '代码的语言', palette, mobile);
  content += text(status.label, width - 28, 29, 10, palette.muted, 'font-weight="600" text-anchor="end"');
  content += circle(centerX, centerY, radius, 'none', 'stroke="' + palette.line + '" stroke-width="23"');
  let shown = [];
  if (data?.totalBytes > 0) {
    shown = collapseLanguages(data.languages);
    let offset = 0;
    shown.forEach(([name, bytes], index) => {
      const color = COLORS[name] || FALLBACK[index % FALLBACK.length];
      const segment = bytes / data.totalBytes * circumference;
      content += circle(centerX, centerY, radius, 'none', 'stroke="' + color + '" stroke-width="23" stroke-dasharray="' + decimal(segment) + ' ' + decimal(circumference - segment) + '" stroke-dashoffset="' + decimal(-offset) + '" transform="rotate(-90 ' + centerX + ' ' + centerY + ')"');
      offset += segment;
    });
    content += text(String(data.languages.length), centerX, centerY + 4, 35, palette.text, 'font-weight="700" text-anchor="middle"');
    content += text('LANGUAGES', centerX, centerY + 25, 10, palette.muted, 'text-anchor="middle"');
    shown.forEach(([name, bytes], index) => {
      const column = Math.floor(index / 5);
      const row = index % 5;
      const x = mobile ? (column ? 220 : 28) : (column ? 604 : 320);
      const y = mobile ? 321 + row * 42 : 113 + row * 34;
      const color = COLORS[name] || FALLBACK[index % FALLBACK.length];
      const ratio = bytes / data.totalBytes * 100;
      const percent = ratio > 0 && ratio < 0.1 ? '<0.1%' : ratio.toFixed(1) + '%';
      const nameSize = mobile ? Math.min(14, 140 / Math.max(1, name.length) * 1.65) : Math.min(14, 175 / Math.max(1, name.length) * 1.65);
      content += circle(x + 4, y - 5, 4, color);
      content += text(name, x + 16, y, decimal(nameSize), palette.text, 'font-weight="600"');
      content += text(percent, mobile ? x + 16 : (column ? 870 : 566), mobile ? y + 17 : y, mobile ? 12 : 13, palette.muted, mobile ? '' : 'text-anchor="end"');
    });
  } else {
    content += text(data ? '0' : 'N/A', centerX, centerY + 7, 34, palette.text, 'font-weight="700" text-anchor="middle"');
    content += text(data ? '暂无代码语言' : '数据暂不可用', centerX, centerY + 30, 12, palette.muted, 'text-anchor="middle"');
    const x = mobile ? 28 : 320;
    const y = mobile ? 331 : 154;
    content += text(data ? '公开仓库还没有可统计的代码字节。' : '等待一次完整的公开语言数据采集。', x, y, 14, palette.muted);
    content += text('缺失数据保留为 N/A，不推测语言占比。', x, y + 26, 12, palette.muted);
  }
  const bytesLabel = data ? count(data.totalBytes) + ' bytes' : 'N/A';
  if (mobile) {
    content += line('M28 529H392', palette.line);
    content += text('公开非 fork 仓库 · 含归档仓库', 28, 553, 12, palette.muted);
    content += text('按代码字节统计，不代表使用时间或熟练度', 28, 577, 12, palette.muted);
    content += text('历史静态站点也计入 · ' + bytesLabel, 28, 601, 11, palette.muted);
  } else {
    content += line('M28 272H872', palette.line);
    content += text('公开非 fork 仓库 · 含归档仓库 · 按代码字节统计，不代表使用时间或熟练度', 28, 294, 12, palette.muted);
    content += text('历史静态站点也计入 · ' + bytesLabel, 28, 316, 11, palette.muted);
  }
  const description = data ? 'GitHub Linguist 代码字节占比，总计 ' + count(data.totalBytes) + ' bytes。' + (data.totalBytes > 0 ? shown.map(([name, bytes]) => name + ' ' + (bytes / data.totalBytes * 100).toFixed(4) + '%').join('，') : '暂无代码字节') + '。自有公开非 fork 仓库，含归档和历史静态站点；不表示熟练度。' : '完整语言数据暂不可用，保留为 N/A，不推测比例。';
  return svg('languages-' + theme + '-' + (mobile ? 'mobile' : 'desktop'), width, height, theme, '代码的语言：公开仓库代码字节占比', description + statusDescription(status), content);
}
