const palettes = {
  light: { bg: '#ffffff', text: '#17212b', muted: '#576574', line: '#dce3e8', accent: '#147d66' },
  dark: { bg: '#11171c', text: '#edf3f7', muted: '#a3b1bd', line: '#33414d', accent: '#70dbb3' },
};
const xml = (value) => String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
const units = (value) => [...value].reduce((sum, c) => sum + (/[^\x00-\x7f]|[MWmw@#%&]/.test(c) ? 1.1 : /[A-Z]/.test(c) ? 0.85 : 0.65), 0);
export function wrapTitle(value, limit) {
  const words = String(value).replace(/\s+/g, ' ').trim().match(/[A-Za-z0-9][A-Za-z0-9._+/-]*|[^A-Za-z0-9]/gu) || ['Untitled'];
  const lines = [];
  let line = '';
  for (const word of words) {
    if (units(line + word) <= limit) { line += word; continue; }
    if (line.trim()) lines.push(line.trim());
    line = '';
    for (const character of word.trimStart()) {
      if (units(line + character) > limit && line) { lines.push(line); line = ''; }
      line += character;
    }
  }
  if (line.trim()) lines.push(line.trim());
  return lines.length ? lines : ['Untitled'];
}
export function renderArticle(item, theme = 'light', mobile = false, index = 0) {
  const t = palettes[theme] || palettes.light, w = mobile ? 420 : 900;
  const lines = wrapTitle(item.title, (w - 56) / 18);
  const h = Math.max(mobile ? 148 : 124, 87 + lines.length * 27);
  const title = xml(item.title), date = xml(item.date?.slice(0, 10) || 'N/A');
  const label = 'NOTE / ' + String(index + 1).padStart(2, '0');
  const body = lines.map((line, i) => '<text x="28" y="' + (65 + i * 27) + '" font-size="18" font-weight="600" fill="' + t.text + '">' + xml(line) + '</text>').join('');
  return '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '" role="img" aria-labelledby="title desc"><title id="title">' + title + '</title><desc id="desc">' + date + ' published on klucen.cn. Open this card to read the article.</desc><rect x=".5" y=".5" width="' + (w - 1) + '" height="' + (h - 1) + '" rx="8" fill="' + t.bg + '" stroke="' + t.line + '"/><g font-family="Segoe UI, Noto Sans SC, Microsoft YaHei, Arial, sans-serif"><text x="28" y="28" font-size="11" font-weight="600" fill="' + t.accent + '">' + label + '</text><text x="' + (w - 28) + '" y="28" text-anchor="end" font-size="11" fill="' + t.muted + '">' + date + '</text>' + body + '<text x="28" y="' + (h - 22) + '" font-size="12" fill="' + t.muted + '">klucen.cn</text><text x="' + (w - 28) + '" y="' + (h - 22) + '" text-anchor="end" font-size="12" fill="' + t.accent + '">READ &#8599;</text></g></svg>\n';
}
