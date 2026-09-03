import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

export const SRC_DIR = here;
export const ROOT = path.resolve(here, '..');
export const PUBLIC_DIR = path.join(here, 'public');

// data/ 整体 gitignore：私有数据目录，绝不入库。
export const DATA_DIR = path.join(ROOT, 'data');
export const TASKS_DIR = path.join(DATA_DIR, 'tasks');
export const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');

// context repo 的固定本地位置。Foreman 监督的全部内容都在这里面。
// 这个位置不可配置：固定在 Foreman 自己目录下，所有任务共用一个入口 ——
// 正因如此，任务里才不需要再记路径。
// 由 agent 按提示词自己接上（软链或 clone），Foreman 不预先创建 ——
// 否则 agent 的"已存在就用、不存在就建"判断会被一个空目录骗过。
export const CONTEXT_REL = 'data/context';
export const CONTEXT_DIR = path.join(DATA_DIR, 'context');

// 默认只监听回环地址：本工具无鉴权，不应暴露到网络。
export const HOST = process.env.FOREMAN_HOST || '127.0.0.1';
export const PORT = Number(process.env.FOREMAN_PORT || 4600);

// 任务信号文件在 context repo 内的约定路径：tasks/<task-id>/
export function signalDirRelative(taskId) {
  return path.posix.join('tasks', taskId);
}

/** 任务信号文件的绝对路径（在 context 本地位置内）。 */
export function signalDirAbsolute(taskId) {
  return path.join(CONTEXT_DIR, 'tasks', taskId);
}

/** 相对路径按 Foreman 根目录展开；绝对路径原样返回；空值返回空串。 */
export function resolveUnderRoot(p) {
  const v = String(p || '').trim();
  if (!v) return '';
  return path.isAbsolute(v) ? v : path.resolve(ROOT, v);
}

export function ensureDirs() {
  // 注意：不创建 CONTEXT_DIR。它由 agent 接上，Foreman 预建空目录会让
  // agent 误判为"已存在"。
  for (const dir of [DATA_DIR, TASKS_DIR]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}
