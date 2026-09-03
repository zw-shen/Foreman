import { esc } from '../util.js';
import { layout } from './layout.js';

function textField({ name, label, hint, value, rows = 3, required = false }) {
  return `<label class="field">
<span class="lbl">${esc(label)}${required ? '' : ' <span class="hint">（可选）</span>'}</span>
${hint ? `<span class="hint">${esc(hint)}</span>` : ''}
<textarea name="${name}" rows="${rows}"${required ? ' required' : ''}>${esc(value || '')}</textarea>
</label>`;
}

function warningsHtml(warnings) {
  if (!warnings || !warnings.length) return '';
  return `<div class="warn-box">
<strong>提示（不阻止创建）</strong>
<ul>${warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>
</div>`;
}

export function newTaskPage({ values = {}, context = {}, warnings = [], error = '' } = {}) {
  const body = `<h1>新建任务</h1>
<p class="lede">只需要描述任务本身。context repo 是全局配置，在<a href="/settings">设置</a>里配一次即可。
提交后 Foreman 会记录 context repo 当前的 HEAD 作为<strong>基线 commit</strong>，并生成提示词 ——
你自己开一个大模型会话贴进去，Foreman 不启动 agent。</p>
<section class="card" style="margin-bottom:16px">
<h2 style="margin-top:0">当前 context repo</h2>
<dl class="kv">
<dt>地址</dt><dd><code>${esc(context.raw || '(未配置)')}</code></dd>
<dt>本地位置</dt><dd><code>${esc(context.mountRel || 'data/context')}</code>
${
  context.mountExists
    ? `<span class="badge good">已就位</span>`
    : `<span class="badge muted">未就位</span>`
}
${context.mountIsGit ? `<span class="badge good">git 仓库</span>` : ''}</dd>
</dl>
<p class="lede" style="margin:12px 0 0">Foreman 只监督这个仓库。你实际改的代码在哪它不关心 ——
agent 必须把改了什么、为什么改写进 context repo，Foreman 才能显示。</p>
</section>
${warningsHtml(warnings)}
${error ? `<div class="err">${esc(error)}</div>` : ''}
<form class="stack card" method="post" action="/tasks">
${textField({ name: 'title', label: '任务标题', value: values.title, rows: 1, required: true, hint: '一句话，看板上显示这个' })}
${textField({ name: 'goal', label: '目标', value: values.goal, rows: 3, required: true, hint: '要做成什么样' })}
${textField({ name: 'background', label: '背景', value: values.background, rows: 3 })}
${textField({ name: 'acceptance', label: '验收标准', value: values.acceptance, rows: 3, hint: '怎样算做完；Foreman 核实时的依据之一' })}
${textField({ name: 'constraints', label: '能做 / 不能做（约束）', value: values.constraints, rows: 3 })}
<div class="row">
<button type="submit">创建任务并生成提示词</button>
<a class="btn ghost" href="/">取消</a>
</div>
</form>`;
  return layout({ title: '新建任务', current: 'new', body });
}
