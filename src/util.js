import os from 'node:os';

const HOME = os.homedir();

const HTML_ESCAPES = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/**
 * 显示用的路径：把家目录前缀缩写成 ~，界面里不暴露用户名。
 * 只用于展示 —— 传给 git 或文件系统的一律用原始绝对路径。
 */
export function displayPath(p) {
  const v = String(p ?? '');
  if (!v || !HOME) return v;
  if (v === HOME) return '~';
  if (v.startsWith(HOME + '/')) return '~' + v.slice(HOME.length);
  return v;
}

/** 所有进入 HTML 的外部内容都必须经过这里：任务字段、repo 文件内容、diff 都是不可信输入。 */
export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);
}

export function relativeTime(date, now = new Date()) {
  if (!date) return '无记录';
  const ms = now.getTime() - new Date(date).getTime();
  if (Number.isNaN(ms)) return '无记录';
  if (ms < 0) return '刚刚';
  const min = Math.floor(ms / 60000);
  if (min < 1) return '刚刚';
  if (min < 60) return `${min} 分钟前`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} 小时前`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day} 天前`;
  const mon = Math.floor(day / 30);
  if (mon < 12) return `${mon} 个月前`;
  return `${Math.floor(mon / 12)} 年前`;
}

export function formatDateTime(date) {
  if (!date) return '';
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ` +
    `${p(d.getHours())}:${p(d.getMinutes())}`
  );
}
