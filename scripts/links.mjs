import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

// Lucide paths are embedded so profile images stay self-contained on GitHub.
const require = createRequire(import.meta.url);
const ICON_DIR = join(dirname(require.resolve('lucide-static/package.json')), 'icons');
const ICON_LICENSE = readFileSync(join(ICON_DIR, '..', 'LICENSE'), 'utf8');
const FONT = 'Segoe UI, Noto Sans SC, Microsoft YaHei, Arial, sans-serif';
const THEMES = {
  light: { background: '#ffffff', text: '#202b34', muted: '#61717e', line: '#dce4e9', accent: '#188360' },
  dark: { background: '#11171c', text: '#edf3f7', muted: '#a3b1bd', line: '#33414d', accent: '#70dbb3' },
};
const NAV = [
  { id: 'blog', label: '博客', icon: 'book-open', url: 'https://www.klucen.cn/' },
  { id: 'repositories', label: '仓库', icon: 'folder-git-2', path: '?tab=repositories' },
  { id: 'contributions', label: '贡献', icon: 'activity', path: '#js-contribution-activity-description' },
  { id: 'rss', label: 'RSS', icon: 'rss', url: 'https://www.klucen.cn/rss.xml' },
];
const number = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const escape = (value) => String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[character]));
const idPart = (value) => String(value).trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'item';

export function navLinks(login = 'KLucen') {
  const owner = encodeURIComponent(String(login || 'KLucen').trim() || 'KLucen');
  return NAV.map((item) => ({
    id: item.id,
    label: item.label,
    icon: item.icon,
    kind: 'navigation',
    url: item.url || 'https://github.com/' + owner + item.path,
  }));
}

export function languageLinks(stats) {
  const source = stats?.languages;
  if (source?.complete !== true || !number(source.totalBytes) || !source.totals || typeof source.totals !== 'object' || Array.isArray(source.totals)) return [];
  const entries = Object.entries(source.totals);
  if (entries.some(([name, bytes]) => !name || !number(bytes))) return [];
  const languages = entries.filter(([, bytes]) => bytes > 0).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const totalBytes = source.totalBytes;
  if (!totalBytes || languages.reduce((sum, [, bytes]) => sum + bytes, 0) !== totalBytes) return [];
  const owner = encodeURIComponent(String(stats?.login || 'KLucen').trim() || 'KLucen');
  return languages.map(([name, bytes]) => ({
    id: 'language-' + Buffer.from(name).toString('hex'),
    label: name,
    icon: 'code-xml',
    kind: 'language',
    bytes,
    percentage: Number((bytes / totalBytes * 100).toFixed(4)),
    url: 'https://github.com/' + owner + '?tab=repositories&q=&type=source&language=' + encodeURIComponent(name),
  }));
}

function iconMarkup(name, color, x = 15, y = 11, scale = .75) {
  const safeName = /^[a-z0-9-]+$/.test(String(name || '')) ? String(name) : 'arrow-up-right';
  let source;
  try {
    source = readFileSync(join(ICON_DIR, safeName + '.svg'), 'utf8');
  } catch {
    source = readFileSync(join(ICON_DIR, 'arrow-up-right.svg'), 'utf8');
  }
  const match = source.match(/<svg[\s\S]*?>([\s\S]*?)<\/svg>/i);
  const inner = match ? match[1] : '';
  return '<g transform="translate(' + x + ' ' + y + ') scale(' + scale + ')" fill="none" stroke="' + color + '" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + inner + '</g>';
}

export function renderLink(link, theme = 'light') {
  theme = theme === 'dark' ? 'dark' : 'light';
  const palette = THEMES[theme];
  const item = link && typeof link === 'object' ? link : {};
  const label = String(item.label || '链接');
  const isLanguage = item.kind === 'language';
  const percentage = isLanguage && number(item.percentage) ? (item.percentage > 0 && item.percentage < 0.1 ? '<0.1' : item.percentage.toFixed(1)) + '%' : '';
  const display = label;
  const textWidth = [...display].reduce((sum, character) => sum + (character.codePointAt(0) > 127 ? 13 : 7.6), 0);
  const width = Math.max(isLanguage ? 132 : 110, Math.ceil(66 + textWidth));
  const height = 40;
  const id = 'link-' + idPart(item.id || label) + '-' + theme;
  const title = escape(isLanguage ? label + ' ' + percentage + '：GitHub 仓库筛选' : label);
  const description = escape(isLanguage ? '点击按 ' + label + ' 筛选自有 GitHub 仓库。' : '点击查看' + label + '。');
  const content = iconMarkup(item.icon || 'arrow-up-right', palette.accent) + '<text x="43" y="25" font-size="13" fill="' + palette.text + '" font-weight="600">' + escape(display) + '</text>';
  const arrow = iconMarkup('chevron-right', palette.muted, width - 24, 12, .65);
  return '<svg xmlns="http://www.w3.org/2000/svg" width="' + width + '" height="' + height + '" viewBox="0 0 ' + width + ' ' + height + '" role="img" aria-labelledby="' + id + '-title ' + id + '-desc"><title id="' + id + '-title">' + title + '</title><desc id="' + id + '-desc">' + description + '</desc><metadata>' + escape(ICON_LICENSE) + '</metadata><rect x="0.5" y="0.5" width="' + (width - 1) + '" height="39" rx="8" fill="' + palette.background + '" stroke="' + palette.line + '"/><g font-family="' + FONT + '">' + content + arrow + '</g></svg>\n';
}
