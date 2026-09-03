import { esc } from './util.js';

function inline(text) {
  let t = esc(text);
  t = t.replace(/`([^`]+)`/g, '<code>$1</code>');
  t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  return t;
}

/**
 * 极简 Markdown 渲染：标题、围栏代码块、缩进代码块、有序/无序列表、checkbox、分隔线、
 * 行内 code 与加粗。不支持表格（会退化成普通段落）。
 * 所有内容先经 esc() 转义 —— 输入来自 context repo，属不可信内容。
 */
export function renderMarkdown(md) {
  if (!md) return '';
  const lines = String(md).split(/\r?\n/);
  const out = [];
  let inFence = false;
  let fenceBuf = [];
  let preBuf = [];
  let listType = null;

  const closeList = () => {
    if (listType) {
      out.push(`</${listType}>`);
      listType = null;
    }
  };
  const flushPre = () => {
    if (preBuf.length) {
      out.push(`<pre><code>${esc(preBuf.join('\n'))}</code></pre>`);
      preBuf = [];
    }
  };
  const openList = (type) => {
    if (listType !== type) {
      closeList();
      out.push(type === 'ul' ? '<ul>' : '<ol>');
      listType = type;
    }
  };

  for (const raw of lines) {
    if (/^\s*```/.test(raw)) {
      if (inFence) {
        out.push(`<pre><code>${esc(fenceBuf.join('\n'))}</code></pre>`);
        fenceBuf = [];
        inFence = false;
      } else {
        flushPre();
        closeList();
        inFence = true;
      }
      continue;
    }
    if (inFence) {
      fenceBuf.push(raw);
      continue;
    }

    if (!raw.trim()) {
      flushPre();
      closeList();
      continue;
    }

    // 缩进 4 空格视为代码块，连续行合并
    if (/^ {4,}\S/.test(raw) && !listType) {
      preBuf.push(raw.replace(/^ {4}/, ''));
      continue;
    }
    flushPre();

    const h = /^(#{1,6})\s+(.*)$/.exec(raw);
    if (h) {
      closeList();
      const lv = Math.min(h[1].length + 1, 6); // 降一级，避免和页面 h1 抢层级
      out.push(`<h${lv}>${inline(h[2])}</h${lv}>`);
      continue;
    }

    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(raw)) {
      closeList();
      out.push('<hr>');
      continue;
    }

    const cb = /^\s*[-*]\s+\[([ xX])\]\s*(.*)$/.exec(raw);
    if (cb) {
      openList('ul');
      const done = cb[1].toLowerCase() === 'x';
      out.push(
        `<li class="chk-item"><span class="chk ${done ? 'done' : ''}">${done ? '✓' : '○'}</span>` +
          `<span>${inline(cb[2])}</span></li>`,
      );
      continue;
    }

    const ul = /^\s*[-*]\s+(.*)$/.exec(raw);
    if (ul) {
      openList('ul');
      out.push(`<li>${inline(ul[1])}</li>`);
      continue;
    }

    const ol = /^\s*\d+[.)]\s+(.*)$/.exec(raw);
    if (ol) {
      openList('ol');
      out.push(`<li>${inline(ol[1])}</li>`);
      continue;
    }

    closeList();
    out.push(`<p>${inline(raw)}</p>`);
  }

  if (inFence && fenceBuf.length) out.push(`<pre><code>${esc(fenceBuf.join('\n'))}</code></pre>`);
  flushPre();
  closeList();
  return out.join('\n');
}
