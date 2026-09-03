import fs from 'node:fs/promises';
import path from 'node:path';
import { signalDirAbsolute, signalDirRelative } from './config.js';
import { parseMessages, awaitingYourReply } from './messages.js';
export const DECLARED_STATES = {
  working: { label: '进行中', action: '不用管' },
  done: { label: '完成', action: '去核实' },
  awaiting_review: { label: '完成等待验收', action: '去看代码、给结论' },
  awaiting_input: { label: '等待回答', action: '去回话' },
  failed: { label: '失败', action: '去看原因' },
};

/** HANDOFF.md 必填段落。匹配放宽，允许标题措辞有小差异。 */
const REQUIRED_SECTIONS = [
  { key: 'goal', label: '目标与现状', test: /目标.*现状|现状.*目标/ },
  { key: 'changes', label: '已改动', test: /已改动|改动了|修改内容/ },
  { key: 'decisions', label: '关键决策与理由', test: /决策|理由|取舍/ },
  { key: 'open', label: '未完成 / 已知问题', test: /未完成|已知问题|遗留/ },
  { key: 'verify', label: '验证方式', test: /验证|如何测试|怎么验/ },
];

/** 判断「验证方式」里是否真的有可执行命令。启发式，不求精确，只求能挡住"跑一下测试"这类空话。 */
function looksLikeCommand(text) {
  if (/```/.test(text)) return true;
  if (/^\s*\$\s+\S+/m.test(text)) return true;
  if (/^\s{4,}\S+/m.test(text)) return true;
  if (/\b(npm|npx|node|yarn|pnpm|git|make|pytest|python3?|cargo|go|mvn|gradle|docker|curl|bash|sh)\s+\S+/.test(text)) {
    return true;
  }
  if (/(^|\s)\.\/\S+/.test(text)) return true;
  return false;
}

/**
 * 把 Markdown 切成段落。
 *
 * 关键点：必填段落下面允许有更深层级的小标题（提示词就要求「已改动」下面按
 * `## <文件路径>` 分节写）。如果无条件把所有 h1~h3 都当边界，「已改动」会被
 * 切成空段落，一个完全照规范写的 agent 反而被判不合格。
 *
 * 做法：先找出匹配必填段落的标题所在的最浅层级，只在该层级（及更浅）切分，
 * 更深的标题算作正文。这样 `# 已改动 / ## 文件` 和 `## 已改动 / ### 文件` 都能正确解析。
 */
function splitSections(markdown) {
  const lines = markdown.split(/\r?\n/);
  const headings = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /^(#{1,6})\s+(.*)$/.exec(lines[i]);
    if (m) headings.push({ line: i, level: m[1].length, text: m[2].trim() });
  }
  if (!headings.length) return [];

  const matchedLevels = headings
    .filter((h) => REQUIRED_SECTIONS.some((r) => r.test.test(h.text)))
    .map((h) => h.level);
  // 没有任何标题命中必填段落时，退回按最浅层级切分
  const boundary = matchedLevels.length
    ? Math.min(...matchedLevels)
    : Math.min(...headings.map((h) => h.level));

  const boundaries = headings.filter((h) => h.level <= boundary);
  const sections = [];
  for (let i = 0; i < boundaries.length; i++) {
    const start = boundaries[i].line + 1;
    const end = i + 1 < boundaries.length ? boundaries[i + 1].line : lines.length;
    sections.push({
      heading: boundaries[i].text,
      body: lines.slice(start, end).join('\n').trim(),
    });
  }
  return sections;
}

export function lintHandoff(markdown) {
  if (!markdown || !markdown.trim()) {
    return {
      exists: false,
      pass: false,
      problems: ['HANDOFF.md 不存在或为空'],
      sections: REQUIRED_SECTIONS.map((s) => ({ label: s.label, ok: false, note: '缺失' })),
    };
  }
  const found = splitSections(markdown);
  const problems = [];
  const sections = [];
  for (const req of REQUIRED_SECTIONS) {
    const hit = found.find((f) => req.test.test(f.heading));
    if (!hit) {
      problems.push(`缺少段落「${req.label}」`);
      sections.push({ label: req.label, ok: false, note: '缺失' });
      continue;
    }
    if (!hit.body) {
      problems.push(`段落「${req.label}」为空`);
      sections.push({ label: req.label, ok: false, note: '为空' });
      continue;
    }
    if (req.key === 'verify' && !looksLikeCommand(hit.body)) {
      problems.push('「验证方式」里没有可执行命令');
      sections.push({ label: req.label, ok: false, note: '无可执行命令' });
      continue;
    }
    sections.push({ label: req.label, ok: true, note: '' });
  }
  return { exists: true, pass: problems.length === 0, problems, sections };
}

export function parseTodo(markdown) {
  if (!markdown) return { total: 0, done: 0, items: [] };
  const items = [];
  for (const line of markdown.split(/\r?\n/)) {
    const m = /^\s*[-*]\s+\[([ xX])\]\s*(.*)$/.exec(line);
    if (m) items.push({ done: m[1].toLowerCase() === 'x', text: m[2].trim() });
  }
  return { total: items.length, done: items.filter((i) => i.done).length, items };
}

function parseStatus(raw) {
  if (raw === null) return { present: false, error: '', state: null, data: null };
  try {
    const data = JSON.parse(raw);
    const state = typeof data.state === 'string' ? data.state : null;
    if (!state || !DECLARED_STATES[state]) {
      return { present: true, error: `state 取值非法：${state ?? '(缺失)'}`, state: null, data };
    }
    const error =
      state === 'failed' && !String(data.reason || '').trim()
        ? 'state=failed 但没有写 reason'
        : state === 'awaiting_input' && !String(data.question || '').trim()
          ? 'state=awaiting_input 但没有写 question'
          : '';
    return { present: true, error, state, data };
  } catch (e) {
    return { present: true, error: `STATUS.json 解析失败：${e.message}`, state: null, data: null };
  }
}

async function readIfExists(file) {
  try {
    return await fs.readFile(file, 'utf8');
  } catch {
    return null;
  }
}

async function mtimeOf(file) {
  try {
    const st = await fs.stat(file);
    return st.mtime;
  } catch {
    return null;
  }
}

/** 读取 context repo 里约定位置的信号文件。Foreman 只读，绝不写。 */
export async function readSignals(taskId) {
  const dir = signalDirAbsolute(taskId);
  const files = {
    task: path.join(dir, 'TASK.md'),
    todo: path.join(dir, 'TODO.md'),
    status: path.join(dir, 'STATUS.json'),
    handoff: path.join(dir, 'HANDOFF.md'),
    changes: path.join(dir, 'CHANGES.md'),
    messages: path.join(dir, 'MESSAGES.md'),
  };
  const [taskMd, todoMd, statusRaw, handoffMd, changesMd, messagesMd] = await Promise.all([
    readIfExists(files.task),
    readIfExists(files.todo),
    readIfExists(files.status),
    readIfExists(files.handoff),
    readIfExists(files.changes),
    readIfExists(files.messages),
  ]);
  const mtimes = (await Promise.all(Object.values(files).map(mtimeOf))).filter(Boolean);
  const lastSignalMtime = mtimes.length
    ? new Date(Math.max(...mtimes.map((d) => d.getTime())))
    : null;

  const parsedStatus = parseStatus(statusRaw);
  const messages = parseMessages(messagesMd || '');

  return {
    dir,
    // 界面上一律显示相对 context repo 的路径，不暴露本机绝对路径
    dirRel: signalDirRelative(taskId),
    present: {
      task: taskMd !== null,
      todo: todoMd !== null,
      status: statusRaw !== null,
      handoff: handoffMd !== null,
      changes: changesMd !== null,
      messages: messagesMd !== null,
    },
    taskMd: taskMd || '',
    todo: parseTodo(todoMd || ''),
    status: parsedStatus,
    handoffMd: handoffMd || '',
    handoffLint: lintHandoff(handoffMd || ''),
    // 改动明细：只有你主动要求时 agent 才会写，Foreman 只负责渲染
    changesMd: changesMd || '',
    // 人机留言：Foreman 唯一会写入的文件
    messages,
    awaitingReply: awaitingYourReply(parsedStatus.state, messages),
    lastSignalMtime,
  };
}
