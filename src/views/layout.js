import { esc } from '../util.js';

const NAV = [
  { href: '/', key: 'board', label: '看板' },
  { href: '/tasks/new', key: 'new', label: '新建任务' },
  { href: '/settings', key: 'settings', label: '设置' },
];

export function layout({ title, current = '', body }) {
  const nav = NAV.map(
    (n) =>
      `<a href="${n.href}"${n.key === current ? ' aria-current="page"' : ''}>${esc(n.label)}</a>`,
  ).join('');
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} · Foreman</title>
<link rel="stylesheet" href="/static/style.css">
</head>
<body>
<header class="top"><div class="top-inner">
<a class="brand" href="/">Foreman<span>更好地管理你的大模型，而不是盲目听信它们</span></a>
<nav class="top-nav">${nav}</nav>
</div></header>
<main>${body}</main>
<footer class="foot">Foreman 只读取 context repo 里的 git 历史与状态文件；不启动 agent，不写 context repo，也不读你的代码。</footer>
<script src="/static/app.js" defer></script>
</body>
</html>`;
}
