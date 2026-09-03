import fs from 'node:fs/promises';
import path from 'node:path';
import { signalDirAbsolute } from './config.js';
import { isValidTaskId } from './store.js';

const FILE = 'MESSAGES.md';
const MAX_LEN = 8000;

// 条目分隔：## YYYY-MM-DD HH:MM <角色>
const ENTRY_RE = /^##\s+(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2})\s+(human|agent)\s*$/;

export const ROLES = { human: '你', agent: 'agent' };

function stamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ` +
    `${p(d.getHours())}:${p(d.getMinutes())}`
  );
}

function messagesPath(taskId) {
  if (!isValidTaskId(taskId)) throw new Error(`非法任务 id: ${taskId}`);
  return path.join(signalDirAbsolute(taskId), FILE);
}

/** 解析成条目列表。格式不认识的开头内容归为一条 role=unknown。 */
export function parseMessages(markdown) {
  if (!markdown || !markdown.trim()) return [];
  const lines = markdown.split(/\r?\n/);
  const entries = [];
  let current = null;
  for (const line of lines) {
    const m = ENTRY_RE.exec(line.trim());
    if (m) {
      if (current) entries.push(current);
      current = { time: m[1].replace(/\s+/g, ' '), role: m[2], body: [] };
    } else if (current) {
      current.body.push(line);
    } else if (line.trim()) {
      current = { time: '', role: 'unknown', body: [line] };
    }
  }
  if (current) entries.push(current);
  return entries.map((e) => ({ ...e, body: e.body.join('\n').trim() }));
}

export async function readMessages(taskId) {
  try {
    const raw = await fs.readFile(messagesPath(taskId), 'utf8');
    return { raw, entries: parseMessages(raw) };
  } catch {
    return { raw: '', entries: [] };
  }
}

/**
 * 追加一条留言。
 *
 * 这是 Foreman **唯一**会写进 context repo 的文件 —— 人的回复本来就该由平台代笔。
 * 绝不要在这里顺手改 STATUS.json：状态是 agent 的声明，平台代写会毁掉
 * 「声明 vs 事实」这条分界线，核实也就没有意义了。
 *
 * 只写文件、不做 git 提交：提交交给 agent 下一次操作时连带完成。
 */
export async function appendMessage(taskId, role, text) {
  if (!ROLES[role]) throw new Error(`未知角色: ${role}`);
  const body = String(text || '').trim();
  if (!body) throw new Error('留言内容不能为空');
  if (body.length > MAX_LEN) throw new Error(`留言过长（上限 ${MAX_LEN} 字）`);

  const file = messagesPath(taskId);
  await fs.mkdir(path.dirname(file), { recursive: true });

  let existing = '';
  try {
    existing = await fs.readFile(file, 'utf8');
  } catch {
    existing = `# 留言\n\n人与 agent 的往来记录。agent 开工前应先读这里。\n`;
  }
  const sep = existing.endsWith('\n') ? '' : '\n';
  const block = `${sep}\n## ${stamp()} ${role}\n\n${body}\n`;
  await fs.writeFile(file, existing + block, 'utf8');
  return { file, role, body };
}

/**
 * 是否在等你回话：agent 声明了 awaiting_input，而最后一条留言不是你发的。
 * 用于在看板上把"该你动手了"标出来。
 */
export function awaitingYourReply(declaredState, entries) {
  if (declaredState !== 'awaiting_input') return false;
  if (!entries.length) return true;
  return entries[entries.length - 1].role !== 'human';
}
