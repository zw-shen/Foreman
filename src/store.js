import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { TASKS_DIR, SETTINGS_FILE, ensureDirs } from './config.js';
import { DEFAULT_PROMPT_TEMPLATE, DEFAULT_AGENT_RULES } from './prompt-template.js';

// 任务 id 只允许小写字母、数字、连字符：用于拼路径，必须防目录穿越。
const TASK_ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

export function isValidTaskId(id) {
  return TASK_ID_RE.test(String(id || ''));
}

function assertTaskId(id) {
  if (!isValidTaskId(id)) throw new Error(`非法任务 id: ${id}`);
}

function newTaskId() {
  const d = new Date();
  const p = (n, w = 2) => String(n).padStart(w, '0');
  const stamp =
    `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}` +
    `-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  return `t${stamp}-${crypto.randomBytes(2).toString('hex')}`;
}

const DEFAULT_SETTINGS = {
  promptTemplate: DEFAULT_PROMPT_TEMPLATE,
  // 对 agent 的通用要求：与任务无关、每次都带上的那部分，可自由编辑
  agentRules: DEFAULT_AGENT_RULES,
  // context repo 是全局配置：所有任务共用同一个，不必每次填。
  // 可以是 git 地址，也可以是本地路径。
  contextRepo: '',
};

export async function readSettings() {
  try {
    const raw = await fs.readFile(SETTINGS_FILE, 'utf8');
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export async function writeSettings(patch) {
  ensureDirs();
  const next = { ...(await readSettings()), ...patch };
  await fs.writeFile(SETTINGS_FILE, JSON.stringify(next, null, 2) + '\n', 'utf8');
  return next;
}

function taskDir(id) {
  assertTaskId(id);
  return path.join(TASKS_DIR, id);
}

export async function getTask(id) {
  if (!isValidTaskId(id)) return null;
  try {
    const raw = await fs.readFile(path.join(taskDir(id), 'task.json'), 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function listTasks() {
  ensureDirs();
  let entries = [];
  try {
    entries = await fs.readdir(TASKS_DIR, { withFileTypes: true });
  } catch {
    return [];
  }
  const tasks = [];
  for (const e of entries) {
    if (!e.isDirectory() || !isValidTaskId(e.name)) continue;
    const t = await getTask(e.name);
    if (t) tasks.push(t);
  }
  tasks.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  return tasks;
}

export async function createTask(fields) {
  ensureDirs();
  const id = newTaskId();
  const record = {
    id,
    title: fields.title || '(未命名任务)',
    goal: fields.goal || '',
    background: fields.background || '',
    acceptance: fields.acceptance || '',
    constraints: fields.constraints || '',
    baselineSha: fields.baselineSha || '',
    baselineBranch: fields.baselineBranch || '',
    createdAt: new Date().toISOString(),
  };
  await fs.mkdir(taskDir(id), { recursive: true });
  await fs.writeFile(
    path.join(taskDir(id), 'task.json'),
    JSON.stringify(record, null, 2) + '\n',
    'utf8',
  );
  return record;
}

export async function savePrompt(id, text) {
  assertTaskId(id);
  await fs.mkdir(taskDir(id), { recursive: true });
  await fs.writeFile(path.join(taskDir(id), 'PROMPT.md'), text, 'utf8');
}

export async function readPrompt(id) {
  try {
    return await fs.readFile(path.join(taskDir(id), 'PROMPT.md'), 'utf8');
  } catch {
    return '';
  }
}
