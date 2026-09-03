import { esc, relativeTime } from '../util.js';
import { VERDICTS } from '../verify.js';
import { layout } from './layout.js';

// 按"人需要做什么"的紧急程度排列，最需要动手的在前。
const COLUMNS = [
  { key: 'awaiting_input', name: '等待回答', act: '去回话' },
  { key: 'awaiting_review', name: '完成等待验收', act: '去看代码' },
  { key: 'done', name: '完成', act: '去核实' },
  { key: 'failed', name: '失败', act: '去看原因' },
  { key: 'working', name: '进行中', act: '不用管' },
  { key: null, name: '未上报', act: '状态文件还没出现' },
];

const DECLARED_TONE = {
  working: 'info',
  done: 'good',
  awaiting_review: 'info',
  awaiting_input: 'warn',
  failed: 'bad',
};

function flagClass(ins) {
  if (ins.verdict === 'error') return 'flag-bad';
  if (ins.verdict === 'unsubstantiated' || ins.verdict === 'contradicted') return 'flag-warn';
  if (ins.verdict === 'verified') return 'flag-good';
  if (ins.declared === 'failed') return 'flag-bad';
  return '';
}

function card(ins) {
  const t = ins.task;
  const v = VERDICTS[ins.verdict];
  const declaredTone = DECLARED_TONE[ins.declared] || 'muted';

  const badges = [
    `<span class="badge ${declaredTone}">${esc(ins.declaredLabel)}</span>`,
    ins.verdict === 'none' ? '' : `<span class="badge ${v.tone}">${esc(v.label)}</span>`,
  ]
    .filter(Boolean)
    .join('');

  const question =
    ins.declared === 'awaiting_input' && ins.signals?.status?.data?.question
      ? `<div class="qn">${esc(ins.signals.status.data.question)}</div>`
      : '';

  const reason =
    ins.declared === 'failed' && ins.signals?.status?.data?.reason
      ? `<div class="why">${esc(String(ins.signals.status.data.reason).slice(0, 160))}</div>`
      : '';

  const why =
    ins.verdictReasons.length > 0
      ? `<div class="why">${esc(ins.verdictReasons.slice(0, 2).join('；'))}</div>`
      : ins.error
        ? `<div class="why">${esc(ins.error)}</div>`
        : '';

  const todo = ins.signals?.todo;
  const meta = [
    `<span title="基线之后 context repo 的 commit 数">${ins.commits.length} commit</span>`,
    ins.diffStat.files
      ? `<span title="记录产出量">+${ins.diffStat.insertions}/-${ins.diffStat.deletions}</span>`
      : '',
    todo && todo.total ? `<span title="TODO 完成度">${todo.done}/${todo.total} TODO</span>` : '',
    ins.signals?.present?.changes ? `<span title="已有改动明细">有明细</span>` : '',
    `<span title="最后活动时间">${esc(relativeTime(ins.lastActivity))}</span>`,
  ]
    .filter(Boolean)
    .join('');

  return `<article class="tcard ${flagClass(ins)}">
<a class="title" href="/tasks/${encodeURIComponent(t.id)}">${esc(t.title)}</a>
<div class="row">${badges}</div>
${question}${reason}${why}
<div class="meta">${meta}</div>
</article>`;
}

export function boardPage(inspections, context = {}) {
  const needAttention = inspections.filter(
    (i) => i.verdict === 'unsubstantiated' || i.verdict === 'contradicted',
  ).length;
  const needYou = inspections.filter(
    (i) => i.declared === 'awaiting_input' || i.declared === 'awaiting_review',
  ).length;
  const broken = inspections.filter((i) => i.verdict === 'error').length;

  const contextBar = `<div class="row" style="margin-bottom:16px">
<span class="tag">context repo</span>
<code>${esc(context.raw || '(未配置)')}</code>
${
  context.mountExists
    ? '<span class="badge good">已就位</span>'
    : '<span class="badge muted">未就位</span>'
}
${
  context.mountExists && !context.mountIsGit
    ? '<span class="badge warn">不是 git 仓库</span>'
    : ''
}
<a href="/settings">修改</a>
</div>`;

  const summary = `<div class="summary">
<div class="metric"><span class="n">${inspections.length}</span><span class="k">任务总数</span></div>
<div class="metric${needAttention ? ' alert' : ''}"><span class="n">${needAttention}</span><span class="k">存疑 / 自相矛盾</span></div>
<div class="metric"><span class="n">${needYou}</span><span class="k">等你处理</span></div>
<div class="metric"><span class="n">${broken}</span><span class="k">无法核实</span></div>
</div>`;

  const cols = COLUMNS.map((col) => {
    const items = inspections.filter((i) => i.declared === col.key);
    const bodyHtml = items.length
      ? items.map(card).join('')
      : `<div class="empty">无</div>`;
    return `<section class="col">
<div class="col-head"><span class="name">${esc(col.name)}</span><span class="count">${items.length}</span><span class="act">${esc(col.act)}</span></div>
<div class="col-body">${bodyHtml}</div>
</section>`;
  }).join('');

  const body =
    inspections.length === 0
      ? `<h1>看板</h1>
${contextBar}
<p class="lede">还没有任务。新建一个任务，Foreman 会记录 context repo 的基线 commit，并生成交给 agent 的提示词。</p>
<p><a class="btn" href="/tasks/new">新建第一个任务</a></p>`
      : `<div class="spread"><h1>看板</h1><a class="btn" href="/tasks/new">新建任务</a></div>
${contextBar}
<p class="lede">左边的徽章是 agent 自己声明的状态，右边的是 Foreman 用 context repo 的 git 记录核实的结论。两者不一致时以核实结论为准。</p>
${summary}
<div class="board">${cols}</div>`;

  return layout({ title: '看板', current: 'board', body });
}
