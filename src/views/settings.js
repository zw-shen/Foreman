import { esc, displayPath } from '../util.js';
import { PLACEHOLDER_HELP } from '../prompt-template.js';
import { layout } from './layout.js';

function knowledgeSection(knowledge, mountShown) {
  if (!knowledge.exists) {
    return `<p class="lede">context 本地位置还不存在：<code>${esc(mountShown)}</code><br>
由 agent 按提示词接上（本地路径做软链，git 地址则 clone），Foreman 不代建。</p>`;
  }
  if (knowledge.entries.length === 0) {
    return `<p class="lede">context 已就位但还没有知识条目：<code>${esc(mountShown)}</code></p>`;
  }
  return `<p class="lede">共 ${knowledge.entries.length} 个条目。提示词里只放索引，正文由 agent 按需读取。</p>
${knowledge.groups
  .map(
    (g) => `<h3>${esc(g.name)}</h3><ul>${g.items
      .map(
        (i) =>
          `<li><code>${esc(i.rel)}</code> — ${esc(i.title)}${
            i.summary ? `：${esc(i.summary)}` : ''
          }</li>`,
      )
      .join('')}</ul>`,
  )
  .join('')}`;
}

export function settingsPage({ settings, knowledge, context, preview = '', saved = false }) {
  const phList = PLACEHOLDER_HELP.map(
    (h) => `<li><code>${esc(h.ph)}</code> — ${esc(h.text)}</li>`,
  ).join('');

  const warnings = context.warnings?.length
    ? `<div class="warn-box"><strong>提示</strong>
<ul>${context.warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul></div>`
    : '';

  const body = `<h1>设置</h1>
${saved ? '<div class="ok">已保存</div>' : ''}
<div class="stack">
<section class="card">
<h2 style="margin-top:0">context repo</h2>
<p class="lede">Foreman 唯一监督的仓库，所有任务共用。里面放 <code>base/</code>（通用知识）、
<code>projects/</code>（项目知识）、<code>tasks/</code>（任务记录）。填 git 地址或本地路径都行。</p>
<p class="lede"><strong>context 本地位置</strong>固定在 <code>${esc(context.mountRel)}</code>（不可配置）。
agent 会按提示词把你填的仓库接到这里：本地路径做软链，git 地址则 clone。
它在 <code>data/</code> 下，整体 gitignore，不会被提交上去。</p>
${warnings}
<form class="stack" method="post" action="/settings">
<label class="field">
<span class="lbl">地址或本地路径</span>
<span class="hint">填 git 地址（如 <code>git@…:you/ctx.git</code>）直接手输；本地目录可以用下面的「浏览」选，也能新建。</span>
<input class="mono" type="text" id="contextRepo" name="contextRepo" value="${esc(settings.contextRepo || '')}"
placeholder="git@example.com:you/your-context-repo.git" spellcheck="false" autocomplete="off">
</label>
<div class="row">
<button type="button" class="ghost" data-browse-toggle="#dirbrowser">浏览本地目录…</button>
</div>
<div class="dirbrowser" id="dirbrowser" hidden data-target="#contextRepo">
<div class="db-bar">
<button type="button" class="ghost db-up">上一级</button>
<button type="button" class="ghost db-home">家目录</button>
<code class="db-path"></code>
</div>
<div class="db-list"></div>
<div class="db-msg"></div>
<div class="db-actions">
<button type="button" class="db-pick">选用当前目录</button>
<span class="db-sep"></span>
<input type="text" class="db-newname mono" placeholder="新目录名" spellcheck="false" autocomplete="off">
<label class="db-check"><input type="checkbox" class="db-gitinit" checked> 同时 git init</label>
<button type="button" class="ghost db-create">在此新建</button>
</div>
</div>
<div class="row" style="margin-top:4px">
<span class="tag">context 本地位置</span>
<code>${esc(displayPath(context.mount))}</code>
${
  context.mountExists
    ? '<span class="badge good">已就位</span>'
    : '<span class="badge muted">未就位</span>'
}
${
  context.mountExists
    ? context.mountIsGit
      ? '<span class="badge good">git 仓库</span>'
      : '<span class="badge warn">不是 git 仓库</span>'
    : ''
}
</div>
<div class="row"><button type="submit" name="saveContext" value="1">保存 context repo</button></div>
</form>
</section>

<section class="card">
<h2 style="margin-top:0">知识库条目</h2>
${knowledgeSection(knowledge, displayPath(context.mount))}
</section>

<section class="card">
<h2 style="margin-top:0">对 agent 的通用要求</h2>
<p class="lede">与具体任务无关、每个任务都会带上的要求 —— 团队规范、语言偏好、禁止事项放这里。
它通过 <code>{{RULES}}</code> 进入提示词，纯文本，随便改。</p>
<form class="stack" method="post" action="/settings">
<label class="field">
<span class="lbl">要求内容</span>
<textarea class="mono" name="agentRules" rows="14" spellcheck="false">${esc(
    settings.agentRules || '',
  )}</textarea>
</label>
<div class="row">
<button type="submit" name="saveRules" value="1">保存要求</button>
<button type="submit" name="resetRules" value="1" class="ghost">恢复默认要求</button>
</div>
</form>
</section>

<section class="card">
<h2 style="margin-top:0">提示词模板</h2>
<p class="lede">决定各部分的顺序和措辞。占位符在生成时替换：</p>
<ul>${phList}</ul>
<form class="stack" method="post" action="/settings">
<label class="field">
<span class="lbl">模板内容</span>
<textarea class="mono" name="promptTemplate" rows="14" spellcheck="false">${esc(
    settings.promptTemplate,
  )}</textarea>
</label>
<div class="row">
<button type="submit" name="saveTemplate" value="1">保存模板</button>
<button type="submit" name="reset" value="1" class="ghost">恢复默认模板</button>
</div>
</form>
</section>

<section class="card prompt-box">
<h2 style="margin-top:0">完整提示词预览</h2>
<p class="lede">下面是用一个<strong>示例任务</strong>拼出来的完整提示词，
包含 <code>{{PROTOCOL}}</code> 展开后的全部机制约定 —— 上面两个框改完，这里就会跟着变。
实际任务的提示词在各自的任务页里。</p>
<div class="copy-row"><button data-copy="#prompt-text">复制预览</button>
<span class="copy-status"></span></div>
<pre id="prompt-text">${esc(preview)}</pre>
</section>
</div>`;

  return layout({ title: '设置', current: 'settings', body });
}
