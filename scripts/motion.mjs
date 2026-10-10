const FONT = 'Segoe UI, Noto Sans SC, Microsoft YaHei, Arial, sans-serif';
const THEMES = {
  light: { background: '#ffffff', text: '#202b34', muted: '#61717e', line: '#dce4e9', accent: '#188360', heat: ['#edf1f4', '#b9e7cb', '#72c9a0', '#359d75', '#147d66'] },
  dark: { background: '#11171c', text: '#edf3f7', muted: '#a3b1bd', line: '#33414d', accent: '#70dbb3', heat: ['#26313b', '#234d3c', '#327c57', '#51b982', '#7ee3ad'] },
};
const escape = (value) => String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[character]));
const finite = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const round = (value) => Number(value.toFixed(4));
const text = (value, x, y, size, color, extra = '') => '<text x="' + x + '" y="' + y + '" font-size="' + size + '" fill="' + color + '" ' + extra + '>' + escape(value) + '</text>';
function shell(id, width, height, palette, title, description, styles, body) {
  return '<svg xmlns="http://www.w3.org/2000/svg" width="' + width + '" height="' + height + '" viewBox="0 0 ' + width + ' ' + height + '" role="img" aria-labelledby="' + id + '-title ' + id + '-desc"><title id="' + id + '-title">' + escape(title) + '</title><desc id="' + id + '-desc">' + escape(description) + '</desc><style>' + styles + '</style><rect x=".5" y=".5" width="' + (width - 1) + '" height="' + (height - 1) + '" rx="8" fill="' + palette.background + '" stroke="' + palette.line + '"/><g font-family="' + FONT + '">' + body + '</g></svg>\n';
}
function beijingDate(value) {
  const parsed = typeof value === 'string' ? new Date(value) : null;
  if (!parsed || !Number.isFinite(parsed.getTime())) return 'N/A';
  return new Date(parsed.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 16).replace('T', ' ');
}
function status(stats) {
  const stale = Array.isArray(stats?.collection?.cacheUsed) ? stats.collection.cacheUsed.filter((item) => item?.stale === true) : [];
  const dates = stale.map((item) => item.fetchedAt).filter((value) => typeof value === 'string' && Number.isFinite(Date.parse(value))).sort((a, b) => Date.parse(a) - Date.parse(b));
  if (stale.length) return { label: '缓存数据', stamp: beijingDate(dates[0]), fresh: false };
  if (stats?.collection?.complete !== true) return { label: '采集未完成', stamp: beijingDate(stats?.generatedAt), fresh: false };
  return { label: '最近采集', stamp: beijingDate(stats?.generatedAt), fresh: true };
}
export function renderStatus(stats, theme = 'light', mobile = false, animate = true) {
  const palette = THEMES[theme] || THEMES.light;
  const width = mobile ? 420 : 900, height = mobile ? 64 : 44;
  const data = status(stats);
  const motion = data.fresh && animate;
  const styles = motion ? '.sync-dot{opacity:1;animation:sync-breathe 4s cubic-bezier(0.77,0,0.175,1) 2 forwards}@keyframes sync-breathe{0%,100%{opacity:1}50%{opacity:.35}}@media(prefers-reduced-motion:reduce){.sync-dot{animation:none}}' : '.sync-dot{opacity:1}';
  let body = '<circle class="sync-dot" cx="25" cy="' + (mobile ? 23 : 22) + '" r="4" fill="' + (data.fresh ? palette.accent : palette.muted) + '"/>';
  body += text('每日自动更新', 40, mobile ? 28 : 27, 13, palette.text, 'font-weight="600"');
  body += text('09:17 北京时间', mobile ? 178 : 148, mobile ? 28 : 27, 12, palette.muted);
  body += text(data.label + ' ' + data.stamp + (mobile ? '' : ' 北京时间'), mobile ? 40 : 872, mobile ? 50 : 27, 11, palette.muted, mobile ? '' : 'text-anchor="end"');
  return shell('sync-' + theme + '-' + (mobile ? 'mobile' : 'desktop'), width, height, palette, '每日自动更新计划', 'GitHub Actions 每日北京时间 09:17 更新公开数据。' + data.label + ' ' + data.stamp + ' 北京时间。状态点表示更新计划，不表示在线状态；动效仅播放两轮，减少动效模式显示静态。', styles, body);
}
function weeksFromCalendar(stats) {
  const calendar = stats?.contributions?.calendar;
  if (!Array.isArray(calendar) || !calendar.length) return [];
  const weeks = new Map();
  let previous = null;
  for (const day of calendar) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day?.date || '') || !finite(day.count)) return [];
    const stamp = Date.parse(day.date + 'T00:00:00Z');
    if (!Number.isFinite(stamp) || new Date(stamp).toISOString().slice(0, 10) !== day.date || (previous !== null && stamp <= previous)) return [];
    previous = stamp;
    const sunday = new Date(stamp - new Date(stamp).getUTCDay() * 86400000).toISOString().slice(0, 10);
    const value = weeks.get(sunday) || { date: sunday, count: 0 };
    value.count += day.count;
    weeks.set(sunday, value);
  }
  return [...weeks.values()];
}
function positions(weeks, mobile) {
  const half = mobile ? Math.ceil(weeks.length / 2) : weeks.length;
  const step = (mobile ? 364 : 844) / Math.max(1, half - 1);
  return weeks.map((week, index) => {
    const row = mobile && index >= half ? 1 : 0;
    const column = row ? weeks.length - 1 - index : index;
    return { ...week, x: round(28 + column * step), y: mobile ? 48 + row * 23 : 47 };
  });
}
function travelKeyframes(points) {
  const distances = [0];
  for (let i = 1; i < points.length; i++) distances.push(distances[i - 1] + Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y));
  const total = distances.at(-1) || 1;
  return points.map((point, index) => round(distances[index] / total * 100) + '%{transform:translate(' + point.x + 'px,' + point.y + 'px)}').join('');
}
export function renderTrail(stats, theme = 'light', mobile = false, animate = true) {
  const palette = THEMES[theme] || THEMES.light;
  const width = mobile ? 420 : 900, height = mobile ? 112 : 90;
  const weeks = weeksFromCalendar(stats);
  const points = positions(weeks, mobile);
  const maximum = Math.max(0, ...weeks.map((week) => week.count));
  const motion = animate && maximum > 0 && points.length > 1;
  let body = text('CONTRIBUTION TRAIL', 28, 24, 11, palette.accent, 'font-weight="700"');
  body += text(weeks.length ? weeks.length + ' WEEKS' : 'N/A', width - 28, 24, 10, palette.muted, 'text-anchor="end"');
  let styles = '.trail-cursor{opacity:0}';
  if (points.length) {
    const path = points.map((point, index) => (index ? 'L' : 'M') + point.x + ' ' + point.y).join(' ');
    body += '<path d="' + path + '" fill="none" stroke="' + palette.line + '" stroke-width="1"/>';
    for (const point of points) {
      const level = point.count ? Math.max(1, Math.ceil(point.count / maximum * 4)) : 0;
      body += '<rect data-week="' + point.date + '" data-count="' + point.count + '" x="' + round(point.x - 4) + '" y="' + (point.y - 4) + '" width="8" height="8" rx="2" fill="' + palette.heat[level] + '"><title>' + point.date + ' UTC week: ' + point.count + '</title></rect>';
    }
    if (motion) {
      styles = '.trail-cursor{opacity:0;animation:trail-travel 20s linear 2 forwards,trail-visibility 20s linear 2 forwards}@keyframes trail-travel{' + travelKeyframes(points) + '}@keyframes trail-visibility{0%,100%{opacity:0}1%,98%{opacity:1}}@media(prefers-reduced-motion:reduce){.trail-cursor{animation:none!important;opacity:0}}';
      for (let index = 2; index >= 0; index--) {
        const size = index === 0 ? 7 : 5;
        body += '<g class="trail-cursor" style="animation-delay:' + round(index * .18) + 's,' + round(index * .18) + 's"><rect x="' + (-size / 2) + '" y="' + (-size / 2) + '" width="' + size + '" height="' + size + '" rx="1" fill="' + palette.accent + '" opacity="' + (index === 0 ? 1 : .6 - index * .15) + '"/></g>';
      }
    }
    body += text(mobile ? '每格代表一周 · 色深随贡献数变化' : '每格代表一周 · 色深随贡献数变化 · 像素巡游仅为装饰', 28, height - 15, 11, palette.muted);
  } else {
    body += text('公开贡献数据暂不可用', 28, mobile ? 61 : 56, 13, palette.muted);
    body += text('等待完整采集后生成每周轨迹', 28, height - 15, 11, palette.muted);
  }
  const description = points.length ? '真实公开贡献日历按 UTC 星期日分周汇总，共 ' + weeks.length + ' 周，合计 ' + weeks.reduce((sum, week) => sum + week.count, 0) + ' 次。固定节点色深表示该周贡献数，移动像素仅为装饰，不表示数据变化。20 秒一轮，两轮后停止；减少动效或不支持动画时保留完整静态轨迹。' : '公开贡献日历暂不可用，未绘制或推测每周数据。';
  return shell('trail-' + theme + '-' + (mobile ? 'mobile' : 'desktop'), width, height, palette, '每周公开贡献轨迹', description, styles, body);
}
