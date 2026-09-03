import fs from 'node:fs/promises';
import path from 'node:path';
import { CONTEXT_DIR, resolveUnderRoot } from './config.js';

const MAX_DEPTH = 5;
const MAX_FILES = 500;
// tasks/ 是任务记录，不是知识条目，不进索引
const SKIP_DIRS = new Set(['.git', 'node_modules', '.foreman', 'tasks']);

/**
 * 条目说明的提取规则（暂定）：标题取第一个一级标题，摘要取标题之后第一个非空正文行。
 * 若改成要求 front-matter 摘要，只需替换这个函数。
 */
async function describe(filePath) {
  let text = '';
  try {
    const fh = await fs.open(filePath, 'r');
    try {
      const buf = Buffer.alloc(4096);
      const { bytesRead } = await fh.read(buf, 0, buf.length, 0);
      text = buf.subarray(0, bytesRead).toString('utf8');
    } finally {
      await fh.close();
    }
  } catch {
    return { title: path.basename(filePath), summary: '' };
  }

  const lines = text.split(/\r?\n/);
  let title = '';
  let summary = '';
  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;
    if (!title) {
      const m = /^#\s+(.*)$/.exec(t);
      if (m) {
        title = m[1].trim();
        continue;
      }
    }
    if (title && !summary && !t.startsWith('#') && !t.startsWith('```')) {
      summary = t;
      break;
    }
    if (!title && !t.startsWith('#')) {
      // 没有一级标题的文件：用首行当摘要
      summary = t;
      break;
    }
  }
  if (!title) title = path.basename(filePath, path.extname(filePath));
  if (summary.length > 140) summary = summary.slice(0, 140) + '…';
  return { title, summary };
}

async function walk(root, dir, depth, out) {
  if (depth > MAX_DEPTH || out.length >= MAX_FILES) return;
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (out.length >= MAX_FILES) return;
    const full = path.join(dir, e.name);
    // withFileTypes 对 symlink 返回 isSymbolicLink，需要 stat 一次判断实际类型
    let isDir = e.isDirectory();
    let isFile = e.isFile();
    if (e.isSymbolicLink()) {
      try {
        const st = await fs.stat(full);
        isDir = st.isDirectory();
        isFile = st.isFile();
      } catch {
        continue;
      }
    }
    if (isDir) {
      if (SKIP_DIRS.has(e.name)) continue;
      await walk(root, full, depth + 1, out);
    } else if (isFile && /\.(md|markdown|txt)$/i.test(e.name)) {
      const rel = path.relative(root, full);
      const { title, summary } = await describe(full);
      out.push({ rel, title, summary, group: rel.split(path.sep)[0] || '.' });
    }
  }
}

/**
 * 扫描知识库，返回条目索引。
 * 只返回"有哪些条目、各自讲什么"，不返回正文 —— 正文由 agent 按需自己去读。
 */
export async function knowledgeIndex(rootPath) {
  // 默认扫 context repo 的本地位置；相对路径按 Foreman 根目录展开
  const root = resolveUnderRoot(rootPath) || CONTEXT_DIR;
  let exists = true;
  try {
    const st = await fs.stat(root);
    if (!st.isDirectory()) exists = false;
  } catch {
    exists = false;
  }
  if (!exists) return { root, exists: false, entries: [], groups: [] };

  const entries = [];
  await walk(root, root, 0, entries);
  entries.sort((a, b) => a.rel.localeCompare(b.rel));

  const groupMap = new Map();
  for (const e of entries) {
    if (!groupMap.has(e.group)) groupMap.set(e.group, []);
    groupMap.get(e.group).push(e);
  }
  const groups = [...groupMap.entries()].map(([name, items]) => ({ name, items }));
  return { root, exists: true, entries, groups };
}
