import { execFile } from 'node:child_process';
import fs from 'node:fs';

const SHA_RE = /^[0-9a-fA-F]{7,40}$/;
const UNIT = '\x1f'; // 字段分隔符，避免 commit message 里的字符干扰解析
const REC = '\x1e'; // 记录分隔符

/**
 * 执行 git 命令。
 * 一律用 execFile + 参数数组，不经过 shell，因此 repo 路径 / sha 等外部输入
 * 不可能被解释成命令。切勿改成字符串拼接或 exec。
 */
function execGit(repoPath, args, { maxBuffer = 16 * 1024 * 1024 } = {}) {
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      ['-C', repoPath, ...args],
      { maxBuffer, timeout: 30_000, encoding: 'utf8' },
      (err, stdout, stderr) => {
        if (err) {
          err.stderr = String(stderr || '');
          return reject(err);
        }
        resolve(String(stdout));
      },
    );
  });
}

function assertSha(sha) {
  if (!SHA_RE.test(String(sha || ''))) {
    throw new Error(`不是合法的 commit sha: ${sha}`);
  }
}

export async function isGitRepo(repoPath) {
  try {
    if (!fs.existsSync(repoPath) || !fs.statSync(repoPath).isDirectory()) return false;
    await execGit(repoPath, ['rev-parse', '--git-dir']);
    return true;
  } catch {
    return false;
  }
}

export async function headSha(repoPath) {
  const out = await execGit(repoPath, ['rev-parse', 'HEAD']);
  return out.trim();
}

export async function currentBranch(repoPath) {
  try {
    const out = await execGit(repoPath, ['rev-parse', '--abbrev-ref', 'HEAD']);
    return out.trim();
  } catch {
    return '';
  }
}

export async function commitExists(repoPath, sha) {
  assertSha(sha);
  try {
    await execGit(repoPath, ['cat-file', '-e', `${sha}^{commit}`]);
    return true;
  } catch {
    return false;
  }
}

/** 基线之后的 commit 列表（不含基线本身），新的在前。 */
export async function commitsSince(repoPath, baselineSha) {
  assertSha(baselineSha);
  const format = ['%H', '%h', '%an', '%aI', '%s'].join(UNIT) + REC;
  const out = await execGit(repoPath, ['log', `--format=${format}`, `${baselineSha}..HEAD`]);
  return out
    .split(REC)
    .map((r) => r.replace(/^\n/, ''))
    .filter((r) => r.trim() !== '')
    .map((rec) => {
      const [sha, shortSha, author, isoDate, subject] = rec.split(UNIT);
      return { sha, shortSha, author, isoDate, subject: subject ?? '' };
    });
}

/** 基线到 HEAD 的整体改动量，用于判断"是否有真实 diff"。 */
export async function diffStatSince(repoPath, baselineSha) {
  assertSha(baselineSha);
  const out = await execGit(repoPath, ['diff', '--shortstat', `${baselineSha}..HEAD`]);
  const files = /(\d+) files? changed/.exec(out);
  const ins = /(\d+) insertions?\(\+\)/.exec(out);
  const del = /(\d+) deletions?\(-\)/.exec(out);
  return {
    files: files ? Number(files[1]) : 0,
    insertions: ins ? Number(ins[1]) : 0,
    deletions: del ? Number(del[1]) : 0,
  };
}

/** 单个 commit 的 stat + patch，供详情页展开查看。 */
export async function commitPatch(repoPath, sha) {
  assertSha(sha);
  return execGit(repoPath, ['show', '--stat', '--patch', '--no-color', sha]);
}

/** 最近一次 commit 的时间，用于"最后活动时间"。 */
export async function lastCommitDate(repoPath) {
  try {
    const out = await execGit(repoPath, ['log', '-1', '--format=%aI']);
    const v = out.trim();
    return v ? new Date(v) : null;
  } catch {
    return null;
  }
}
