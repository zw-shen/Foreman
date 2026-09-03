import { esc, relativeTime, formatDateTime, displayPath } from '../util.js';
import { VERDICTS } from '../verify.js';
import { renderMarkdown } from '../markdown.js';
import { layout } from './layout.js';

const DECLARED_TONE = {
  working: 'info',
  done: 'good',
  awaiting_review: 'info',
  awaiting_input: 'warn',
  failed: 'bad',
};

function verdictPanel(ins) {
  const v = VERDICTS[ins.verdict];
  const bits = [];
  if (ins.error) bits.push(`<div class="err">${esc(ins.error)}</div>`);
  if (ins.verdictReasons.length) {
    bits.push(`<ul>${ins.verdictReasons.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>`);
  }
  if (ins.issues.length) {
    bits.push(
      `<h3>状态文件问题</h3><ul>${ins.issues.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>`,
    );
  }
  if (ins.verdict === 'verified') {
    bits.push(
      `<div class="ok">声明完成，且基线之后 context repo 有 ${ins.commits.length} 个 commit、` +
        `${ins.diffStat.files} 个文件产出，交接文档校验通过。</div>`,
    );
  }
  if (ins.verdict === 'none' && !ins.error) {
    bits.push(
      `<p class="lede">当前声明态不涉及"完成"，Foreman 暂不给核实结论，只展示已记录的事实。</p>`,
    );
  }
  return `<section class="card stack">
<div class="spread"><h2 style="margin:0">核实结论</h2>
<span class="badge ${v.tone}">${esc(v.label)}</span></div>
${bits.join('')}
</section>`;
}

function metaPanel(ins) {
  const t = ins.task;
  const rows = [
    ['context repo', `<code>${esc(ins.context.raw || '(未配置)')}</code>`],
    ['context 本地位置', `<code>${esc(displayPath(ins.context.mount))}</code>`],
    t.baselineBranch ? ['分支', esc(t.baselineBranch)] : null,
    [
      '基线 commit',
      `<code>${esc(t.baselineSha || '(未记录)')}</code>${
        ins.baselineOk ? '' : ' <span class="badge bad">不可用</span>'
      }`,
    ],
    [
      '任务目录',
      `<code>${esc(ins.signals ? ins.signals.dirRel : '—')}</code> <span class="tag">相对 context repo</span>`,
    ],
    ['创建时间', esc(formatDateTime(t.createdAt))],
    [
      '最后活动',
      `${esc(relativeTime(ins.lastActivity))}${
        ins.lastActivity ? ` <span class="tag">${esc(formatDateTime(ins.lastActivity))}</span>` : ''
      }`,
    ],
  ].filter(Boolean);
  return `<section class="card">
<h2 style="margin-top:0">任务信息</h2>
<dl class="kv">${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v}</dd>`).join('')}</dl>
</section>`;
}

function fileStatus(present) {
  const f = (ok, name) =>
    `<span class="badge ${ok ? 'good' : 'muted'}">${ok ? '✓' : '—'} ${name}</span>`;
  return `<div class="row">${f(present.task, 'TASK.md')}${f(present.todo, 'TODO.md')}${f(
    present.status,
    'STATUS.json',
  )}${f(present.handoff, 'HANDOFF.md')}${f(present.changes, 'CHANGES.md')}${f(
    present.messages,
    'MESSAGES.md',
  )}</div>`;
}

function todoPanel(todo) {
  if (!todo || !todo.total) {
    return `<section class="card"><h2 style="margin-top:0">TODO</h2><p class="lede">TODO.md 还没有可解析的 checkbox 条目。</p></section>`;
  }
  const pct = Math.round((todo.done / todo.total) * 100);
  return `<section class="card">
<div class="spread"><h2 style="margin:0">TODO</h2><span class="tag">${todo.done}/${todo.total}（${pct}%）</span></div>
<div class="progress" style="margin:12px 0"><i style="width:${pct}%"></i></div>
<ul>${todo.items
    .map(
      (i) =>
        `<li class="chk-item"><span class="chk ${i.done ? 'done' : ''}">${
          i.done ? '✓' : '○'
        }</span><span>${esc(i.text)}</span></li>`,
    )
    .join('')}</ul>
</section>`;
}

function handoffPanel(signals) {
  const lint = signals.handoffLint;
  const list = lint.sections
    .map(
      (s) =>
        `<li class="${s.ok ? 'yes' : 'no'}">${s.ok ? '✓' : '✗'} ${esc(s.label)}${
          s.note ? `（${esc(s.note)}）` : ''
        }</li>`,
    )
    .join('');
  const rendered = signals.handoffMd
    ? `<div class="doc" style="margin-top:12px">${renderMarkdown(signals.handoffMd)}</div>`
    : '';
  return `<section class="card">
<div class="spread"><h2 style="margin:0">交接文档</h2>
<span class="badge ${lint.pass ? 'good' : 'warn'}">${lint.pass ? '校验通过' : '不合格'}</span></div>
<ul class="lint">${list}</ul>
${rendered}
</section>`;
}

function changesPanel(ins) {
  const id = encodeURIComponent(ins.task.id);
  if (ins.signals?.changesMd) {
    return `<section class="card">
<div class="spread"><h2 style="margin:0">改动明细</h2>
<a class="btn ghost" href="/tasks/${id}/change-report">再要一次</a></div>
<p class="lede">下面内容由 agent 写在 CHANGES.md 里，Foreman 只做渲染，不解析代码。</p>
<div class="doc">${renderMarkdown(ins.signals.changesMd)}</div>
</section>`;
  }
  return `<section class="card">
<h2 style="margin-top:0">改动明细</h2>
<p class="lede">还没有 CHANGES.md。Foreman 不会自己去看代码 ——
需要知道具体改了哪些文件、改了什么、有什么意义时，由你发起要求，agent 写下来后这里就会显示。</p>
<a class="btn" href="/tasks/${id}/change-report">要求 agent 说明改动明细</a>
</section>`;
}

function commitsPanel(ins) {
  if (!ins.commits.length) {
    return `<section class="card"><h2 style="margin-top:0">context repo 提交记录</h2>
<p class="lede">基线 commit 之后没有任何提交，也就是 agent 什么都没记录下来。</p></section>`;
  }
  const items = ins.commits
    .map(
      (c) => `<details class="commit" data-patch-url="/tasks/${encodeURIComponent(
        ins.task.id,
      )}/commits/${encodeURIComponent(c.sha)}">
<summary><span class="sha">${esc(c.shortSha)}</span><span class="subj">${esc(c.subject)}</span>
<span class="who">${esc(c.author)} · ${esc(relativeTime(c.isoDate))}</span></summary>
<pre class="patch"></pre>
</details>`,
    )
    .join('');
  return `<section class="card">
<div class="spread"><h2 style="margin:0">context repo 提交记录</h2>
<span class="tag">${ins.commits.length} commit · ${ins.diffStat.files} 文件 · +${ins.diffStat.insertions}/-${ins.diffStat.deletions}</span></div>
<p class="lede">基线之后 agent 往 context repo 写下的东西，点开看具体内容。这是核实"完成"的依据。</p>
${items}
</section>`;
}

function messagesPanel(ins) {
  const signals = ins.signals;
  if (!signals) return '';
  const id = encodeURIComponent(ins.task.id);
  const entries = signals.messages || [];

  const thread = entries.length
    ? `<div class="thread">${entries
        .map(
          (e) => `<div class="msg ${e.role}">
<div class="msg-head"><span class="who">${
            e.role === 'human' ? '你' : e.role === 'agent' ? 'agent' : '(格式未知)'
          }</span><span class="when">${esc(e.time)}</span></div>
<div class="msg-body doc">${renderMarkdown(e.body)}</div>
</div>`,
        )
        .join('')}</div>`
    : `<p class="lede">还没有留言。</p>`;

  const hint = signals.awaitingReply
    ? `<div class="warn-box" style="margin-bottom:12px">agent 在等你回话。写下答复后它会在下次动作时读到，
并把状态从「等待回答」改回「进行中」。</div>`
    : '';

  return `<section class="card">
<div class="spread"><h2 style="margin:0">留言</h2>
${signals.awaitingReply ? '<span class="badge warn">等你回话</span>' : ''}</div>
<p class="lede">人和 agent 的往来记录，存在 context repo 的
<code>${esc(signals.dirRel)}/MESSAGES.md</code>。
agent 的会话历史会丢，这个文件不会 —— 换个 agent 接手也读得到。</p>
${hint}
${thread}
<form class="stack" method="post" action="/tasks/${id}/reply" style="margin-top:16px">
<label class="field">
<span class="lbl">回话</span>
<span class="hint">支持 Markdown。这是 Foreman 唯一会写进 context repo 的文件；它不会替 agent 改状态。</span>
<textarea name="text" rows="4" required placeholder="用 SQLite，不要引入新服务。"></textarea>
</label>
<div class="row"><button type="submit">追加留言</button></div>
</form>
</section>`;
}

export function taskPage({ inspection, prompt }) {
  const ins = inspection;
  const t = ins.task;
  const tone = DECLARED_TONE[ins.declared] || 'muted';
  const signals = ins.signals;

  const head = `<div class="spread">
<h1 style="margin:0">${esc(t.title)}</h1>
<a class="btn ghost" href="/">返回看板</a>
</div>
<div class="row" style="margin:8px 0 20px">
<span class="badge ${tone}">声明：${esc(ins.declaredLabel)}</span>
${ins.declaredAction ? `<span class="tag">你要做的：${esc(ins.declaredAction)}</span>` : ''}
<span class="tag">${esc(t.id)}</span>
</div>`;

  const contextNotice = ins.contextWarnings?.length
    ? `<div class="warn-box"><strong>context 提示</strong>
<ul>${ins.contextWarnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul></div>`
    : '';

  const question =
    ins.declared === 'awaiting_input' && signals?.status?.data?.question
      ? `<section class="card"><h2 style="margin-top:0">agent 在等你回答</h2>
<p>${esc(signals.status.data.question)}</p>
<p class="lede">在下面的「留言」里回话。</p></section>`
      : '';

  const reason =
    ins.declared === 'failed' && signals?.status?.data?.reason
      ? `<section class="card"><h2 style="margin-top:0">失败原因（agent 自己写的）</h2>
<div class="doc">${renderMarkdown(signals.status.data.reason)}</div></section>`
      : '';

  const taskMd = signals?.taskMd
    ? `<section class="card"><h2 style="margin-top:0">TASK.md（agent 写的任务契约）</h2>
<div class="doc">${renderMarkdown(signals.taskMd)}</div></section>`
    : '';

  const promptPanel = `<section class="card prompt-box">
<h2 style="margin-top:0">提示词</h2>
<p class="lede">自己开一个大模型会话，把下面内容整段贴进去。里面已包含 context repo 怎么接到本地位置、
状态文件写法、HANDOFF 段落要求和知识库使用方式。</p>
<div class="copy-row"><button data-copy="#prompt-text">复制提示词</button>
<span class="copy-status"></span></div>
<pre id="prompt-text">${esc(prompt)}</pre>
</section>`;

  const signalsPanel = signals
    ? `<section class="card"><h2 style="margin-top:0">任务文件</h2>
<p class="lede">context repo 里的约定目录 <code>${esc(signals.dirRel)}</code>，由 agent 自己创建。</p>
${fileStatus(signals.present)}</section>`
    : '';

  const body = `${head}
${contextNotice}
<div class="stack">
${verdictPanel(ins)}
${question}
${reason}
${metaPanel(ins)}
${signalsPanel}
${signals ? todoPanel(signals.todo) : ''}
${messagesPanel(ins)}
${signals ? handoffPanel(signals) : ''}
${changesPanel(ins)}
${commitsPanel(ins)}
${taskMd}
${promptPanel}
</div>`;

  return layout({ title: t.title, body });
}

/** 「要求 agent 说明改动明细」页：给出一段可复制的追加提示词。 */
export function changeReportPage({ task, prompt }) {
  const body = `<div class="spread">
<h1 style="margin:0">要求说明改动明细</h1>
<a class="btn ghost" href="/tasks/${encodeURIComponent(task.id)}">返回任务</a>
</div>
<p class="lede">Foreman 不是 AI，不会自己去读代码。要知道具体改了什么，得让 agent 写下来。
把下面这段贴回那个 agent 的会话里，它写完并 commit 之后，任务页的「改动明细」就会显示内容。</p>
<section class="card prompt-box">
<div class="copy-row"><button data-copy="#prompt-text">复制</button>
<span class="copy-status"></span></div>
<pre id="prompt-text">${esc(prompt)}</pre>
</section>`;
  return layout({ title: '要求说明改动明细', body });
}
