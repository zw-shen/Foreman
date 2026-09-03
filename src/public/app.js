// 复制提示词
document.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-copy]');
  if (!btn) return;
  const src = document.querySelector(btn.getAttribute('data-copy'));
  if (!src) return;
  const text = src.textContent;
  const status = document.querySelector('.copy-status');
  try {
    await navigator.clipboard.writeText(text);
    if (status) status.textContent = '已复制到剪贴板';
  } catch {
    // clipboard 在非 https/非授权场景可能不可用，退回手动选中
    const range = document.createRange();
    range.selectNodeContents(src);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    if (status) status.textContent = '已选中，请按 Ctrl+C 复制';
  }
});

// 按需加载单个 commit 的 diff
document.addEventListener('toggle', async (e) => {
  const d = e.target;
  if (!(d instanceof HTMLDetailsElement) || !d.open) return;
  if (d.dataset.loaded === '1' || !d.dataset.patchUrl) return;
  d.dataset.loaded = '1';
  const pre = d.querySelector('.patch');
  if (!pre) return;
  pre.textContent = '加载中…';
  try {
    const res = await fetch(d.dataset.patchUrl);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    renderPatch(pre, await res.text());
  } catch (err) {
    pre.textContent = `加载失败：${err.message}`;
    d.dataset.loaded = '';
  }
}, true);

// 用 textContent 构建 DOM，避免把 diff 内容当 HTML 解析
function renderPatch(pre, text) {
  pre.textContent = '';
  const code = document.createElement('code');
  for (const line of text.split('\n')) {
    const span = document.createElement('span');
    if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('diff ') ||
        line.startsWith('index ') || line.startsWith('new file') || line.startsWith('deleted file')) {
      span.className = 'fmeta';
    } else if (line.startsWith('@@')) {
      span.className = 'hunk';
    } else if (line.startsWith('+')) {
      span.className = 'add';
    } else if (line.startsWith('-')) {
      span.className = 'del';
    }
    span.textContent = line + '\n';
    code.appendChild(span);
  }
  pre.appendChild(code);
}


// ---------- 目录浏览器 ----------
// 用 textContent 构建 DOM，不拼 HTML：目录名来自文件系统，属不可信输入。

document.addEventListener('click', (e) => {
  const toggle = e.target.closest('[data-browse-toggle]');
  if (!toggle) return;
  const box = document.querySelector(toggle.getAttribute('data-browse-toggle'));
  if (!box) return;
  box.hidden = !box.hidden;
  if (!box.hidden && !box.dataset.loaded) {
    const target = document.querySelector(box.dataset.target);
    const start = target && target.value.trim().startsWith('/') ? target.value.trim() : '';
    loadDir(box, start);
  }
});

async function loadDir(box, dirPath) {
  const list = box.querySelector('.db-list');
  const msg = box.querySelector('.db-msg');
  msg.textContent = '';
  list.textContent = '加载中…';
  let data;
  try {
    const url = '/api/browse' + (dirPath ? '?path=' + encodeURIComponent(dirPath) : '');
    const res = await fetch(url);
    data = await res.json();
    if (data.error) throw new Error(data.error);
  } catch (err) {
    list.textContent = '';
    msg.textContent = '打不开：' + err.message;
    msg.className = 'db-msg bad';
    return;
  }

  box.dataset.loaded = '1';
  box.dataset.current = data.path;
  box.querySelector('.db-path').textContent = data.display + (data.isGit ? '  [git 仓库]' : '');
  box.querySelector('.db-up').disabled = !data.parent;
  box.dataset.parent = data.parent || '';

  list.textContent = '';
  if (!data.dirs.length) {
    const empty = document.createElement('div');
    empty.className = 'db-empty';
    empty.textContent = '（没有子目录）';
    list.appendChild(empty);
  }
  for (const d of data.dirs) {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'db-item';
    item.dataset.path = data.path.replace(/\/$/, '') + '/' + d.name;
    const nm = document.createElement('span');
    nm.textContent = d.name;
    item.appendChild(nm);
    if (d.isGit) {
      const tag = document.createElement('span');
      tag.className = 'db-git';
      tag.textContent = 'git';
      item.appendChild(tag);
    }
    list.appendChild(item);
  }
  if (data.truncated) {
    const t = document.createElement('div');
    t.className = 'db-empty';
    t.textContent = '（子目录过多，已截断）';
    list.appendChild(t);
  }
}

document.addEventListener('click', async (e) => {
  const box = e.target.closest('.dirbrowser');
  if (!box) return;

  const item = e.target.closest('.db-item');
  if (item) return loadDir(box, item.dataset.path);

  if (e.target.closest('.db-up')) return loadDir(box, box.dataset.parent);
  if (e.target.closest('.db-home')) return loadDir(box, '');

  if (e.target.closest('.db-pick')) {
    const target = document.querySelector(box.dataset.target);
    if (target && box.dataset.current) {
      target.value = box.dataset.current;
      box.hidden = true;
    }
    return;
  }

  if (e.target.closest('.db-create')) {
    const nameInput = box.querySelector('.db-newname');
    const msg = box.querySelector('.db-msg');
    const name = nameInput.value.trim();
    if (!name) {
      msg.textContent = '请填新目录名';
      msg.className = 'db-msg bad';
      return;
    }
    const body = new URLSearchParams({
      parent: box.dataset.current || '',
      name,
      gitInit: box.querySelector('.db-gitinit').checked ? '1' : '0',
    });
    try {
      const res = await fetch('/api/mkdir', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body,
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      nameInput.value = '';
      await loadDir(box, data.path);
      msg.textContent = '已创建 ' + data.display + (data.isGit ? '（已 git init）' : '');
      msg.className = 'db-msg ok-text';
    } catch (err) {
      msg.textContent = '创建失败：' + err.message;
      msg.className = 'db-msg bad';
    }
  }
});
