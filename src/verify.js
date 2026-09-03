import fs from 'node:fs';
import * as git from './git.js';
import { readSignals, DECLARED_STATES } from './signals.js';
import { CONTEXT_DIR, CONTEXT_REL, resolveUnderRoot } from './config.js';
import { readSettings } from './store.js';

export const VERDICTS = {
  verified: { label: '已验证', tone: 'good' },
  unsubstantiated: { label: '存疑', tone: 'warn' },
  contradicted: { label: '自相矛盾', tone: 'warn' },
  none: { label: '—', tone: 'muted' },
  error: { label: '无法核实', tone: 'bad' },
};

// 声明"完成"性质的状态：这些都要求 context repo 里有真实产出作为证据。
const CLAIMS_COMPLETION = new Set(['done', 'awaiting_review']);

/**
 * context repo 的状态探测。Foreman 监督的全部内容都在这个本地位置里。
 * 只提示、不阻止：用普通本地目录当 context 也行，只是不会被版本化、无法核实 commit。
 */
export async function contextState() {
  const settings = await readSettings();
  const raw = String(settings.contextRepo || '').trim();
  const isUrl = /^(https?:\/\/|git@|ssh:\/\/|git:\/\/)/.test(raw);
  const local = isUrl ? '' : resolveUnderRoot(raw);
  const localExists = local ? fs.existsSync(local) : false;
  const localIsGit = localExists ? await git.isGitRepo(local) : false;
  const mountExists = fs.existsSync(CONTEXT_DIR);
  const mountIsGit = mountExists ? await git.isGitRepo(CONTEXT_DIR) : false;

  const warnings = [];
  if (!raw) {
    warnings.push('还没有配置 context repo，请先到「设置」里填一个地址或本地路径。');
  } else if (isUrl) {
    if (!mountExists) {
      warnings.push(`本地位置 ${CONTEXT_REL} 还不存在，agent 会按提示词从该地址 clone。`);
    }
  } else {
    if (!localExists) warnings.push(`context repo 的本地路径不存在：${raw}`);
    else if (!localIsGit) {
      warnings.push(
        `context repo 不是 git 仓库：${raw}。当普通目录用没问题，` +
          `但内容不会被版本化，Foreman 也无法用 commit 核实产出。`,
      );
    }
    if (!mountExists) warnings.push(`本地位置 ${CONTEXT_REL} 还不存在，agent 会按提示词做软链。`);
  }
  if (mountExists && !mountIsGit) {
    warnings.push(
      `本地位置 ${CONTEXT_REL} 已存在但不是 git 仓库，Foreman 无法读取 commit 历史来核实产出。`,
    );
  }

  return {
    raw,
    isUrl,
    local,
    localExists,
    localIsGit,
    mount: CONTEXT_DIR,
    mountRel: CONTEXT_REL,
    mountExists,
    mountIsGit,
    isGit: isUrl || localIsGit || mountIsGit,
    warnings,
  };
}

/**
 * 核实引擎：不采信 agent 的自我汇报。
 * 用 context repo 的 git 事实（有没有真的写下东西）对照它声明的状态。
 * Foreman 只读，绝不写 context repo。
 */
export async function inspect(task, ctx) {
  const context = ctx || (await contextState());
  const result = {
    task,
    context,
    contextOk: false,
    baselineOk: false,
    commits: [],
    diffStat: { files: 0, insertions: 0, deletions: 0 },
    signals: null,
    declared: null,
    declaredLabel: '未上报',
    declaredAction: '',
    verdict: 'none',
    verdictReasons: [],
    issues: [],
    lastActivity: null,
    error: '',
    contextWarnings: context.warnings,
  };

  if (!context.mountExists) {
    result.verdict = 'error';
    result.error = `context 本地位置还不存在：${context.mountRel}`;
    return result;
  }

  // 本地位置存在就能读信号文件，哪怕它不是 git 仓库
  result.signals = await readSignals(task.id);
  const status = result.signals.status;
  result.declared = status.state;
  if (status.state) {
    result.declaredLabel = DECLARED_STATES[status.state].label;
    result.declaredAction = DECLARED_STATES[status.state].action;
  } else if (status.present) {
    result.declaredLabel = '状态文件有问题';
  }
  if (status.error) result.issues.push(status.error);

  result.lastActivity = await computeLastActivity(context, result.signals);

  if (!context.mountIsGit) {
    result.verdict = 'error';
    result.error = `context 本地位置 ${context.mountRel} 不是 git 仓库，无法用 commit 核实产出`;
    return result;
  }
  result.contextOk = true;

  if (task.baselineSha) {
    result.baselineOk = await git.commitExists(context.mount, task.baselineSha);
  }
  if (!result.baselineOk) {
    result.verdict = 'error';
    result.error = task.baselineSha
      ? `基线 commit ${task.baselineSha} 在 context repo 中不存在（历史被重写或换了仓库？）`
      : '任务没有记录基线 commit（创建任务时 context 可能还没就位）';
    return result;
  }

  result.commits = await git.commitsSince(context.mount, task.baselineSha);
  result.diffStat = await git.diffStatSince(context.mount, task.baselineSha);

  const hasEvidence = result.commits.length > 0 && result.diffStat.files > 0;
  const lint = result.signals.handoffLint;

  if (CLAIMS_COMPLETION.has(result.declared)) {
    const reasons = [];
    if (!hasEvidence) reasons.push('基线之后 context repo 里没有任何提交产出');
    if (!lint.pass) reasons.push(...lint.problems);
    result.verdict = reasons.length ? 'unsubstantiated' : 'verified';
    result.verdictReasons = reasons;
  } else if (result.declared === 'failed' && hasEvidence) {
    result.verdict = 'contradicted';
    result.verdictReasons = [
      `声明失败，但基线之后有 ${result.commits.length} 个 commit、` +
        `${result.diffStat.files} 个文件改动，记录下来的东西可能还有用`,
    ];
  } else {
    result.verdict = 'none';
  }

  return result;
}

async function computeLastActivity(context, signals) {
  const commitDate = context.mountIsGit ? await git.lastCommitDate(context.mount) : null;
  const signalDate = signals?.lastSignalMtime || null;
  const candidates = [commitDate, signalDate].filter(Boolean).map((d) => new Date(d).getTime());
  if (!candidates.length) return null;
  return new Date(Math.max(...candidates));
}
