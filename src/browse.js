import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { isGitRepo } from './git.js';
import { displayPath } from './util.js';

const exec = promisify(execFile);

const MAX_ENTRIES = 400;

/**
 * 列出一个目录下的子目录，供前端做目录选择。
 *
 * 只返回目录名，不返回文件内容。所有路径操作走 fs API，不经过 shell。
 * 注意：这个能力会让访问者枚举本机目录结构，因此服务默认只监听回环地址。
 */
export async function listDir(input) {
  const target = input && String(input).trim() ? path.resolve(String(input).trim()) : os.homedir();
  const st = await fs.stat(target);
  if (!st.isDirectory()) throw new Error('不是一个目录');

  let entries = [];
  try {
    entries = await fs.readdir(target, { withFileTypes: true });
  } catch (e) {
    throw new Error(`无法读取目录：${e.code === 'EACCES' ? '没有权限' : e.message}`);
  }

  const dirs = [];
  for (const e of entries) {
    if (dirs.length >= MAX_ENTRIES) break;
    let isDir = e.isDirectory();
    if (e.isSymbolicLink()) {
      try {
        isDir = (await fs.stat(path.join(target, e.name))).isDirectory();
      } catch {
        continue;
      }
    }
    if (!isDir) continue;
    dirs.push({ name: e.name, isGit: await isGitRepo(path.join(target, e.name)) });
  }
  dirs.sort((a, b) => a.name.localeCompare(b.name));

  const parent = path.dirname(target);
  return {
    path: target,
    display: displayPath(target),
    parent: parent === target ? null : parent,
    home: os.homedir(),
    isGit: await isGitRepo(target),
    dirs,
    truncated: dirs.length >= MAX_ENTRIES,
  };
}

/** 在指定父目录下新建一个目录，可选同时 git init。 */
export async function makeDir(parentInput, nameInput, gitInit = false) {
  const name = String(nameInput || '').trim();
  if (!name) throw new Error('目录名不能为空');
  // 只允许单层名字：不含路径分隔符，也不能是 . 或 ..
  if (name === '.' || name === '..' || /[/\\\0]/.test(name)) {
    throw new Error('目录名不能包含路径分隔符');
  }
  const parent = path.resolve(String(parentInput || '').trim() || os.homedir());
  const st = await fs.stat(parent);
  if (!st.isDirectory()) throw new Error('父路径不是目录');

  const target = path.join(parent, name);
  // 解析后必须仍在父目录内
  if (path.dirname(target) !== parent) throw new Error('非法目录名');

  await fs.mkdir(target); // 已存在时会抛 EEXIST，不覆盖

  if (gitInit) {
    // 参数数组传入，不经过 shell
    await exec('git', ['init', '-q', target]);
  }
  return { path: target, display: displayPath(target), isGit: Boolean(gitInit) };
}
