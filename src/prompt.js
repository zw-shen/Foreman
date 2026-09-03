import { signalDirRelative, CONTEXT_REL } from './config.js';
import { knowledgeIndex } from './knowledge.js';
import { readSettings } from './store.js';
import { PLACEHOLDERS } from './prompt-template.js';
import { contextState } from './verify.js';

function section(title, body) {
  const v = (body || '').trim();
  return v ? `${title}\n${v}\n` : '';
}

function renderKnowledgeIndex(index) {
  if (!index.exists) {
    return `## 知识库\n\ncontext 本地位置 ${index.root} 还不存在，索引为空。\n请先按下面「把 context repo 接到本地位置」的步骤接好，再回来查看有哪些条目。\n`;
  }
  if (index.entries.length === 0) {
    return `## 知识库\n\n本地位置：${index.root}\n\n目前还没有任何条目，需要时由你新建。\n`;
  }
  const lines = [`## 知识库索引`, '', `路径：${index.root}`, ''];
  lines.push('下面是全部条目清单。**先看索引，只读你确实需要的条目，不要全量读。**', '');
  for (const g of index.groups) {
    lines.push(`### ${g.name}`, '');
    for (const item of g.items) {
      lines.push(`- \`${item.rel}\` — ${item.title}${item.summary ? `：${item.summary}` : ''}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

function renderTaskInfo(task) {
  const parts = [`## 任务信息`, '', `**标题**：${task.title || '(未命名)'}`, ''];
  const blocks = [
    section('### 目标', task.goal),
    section('### 背景', task.background),
    section('### 验收标准', task.acceptance),
    section('### 能做 / 不能做（约束）', task.constraints),
  ].filter(Boolean);
  return parts.join('\n') + blocks.join('\n');
}

function renderRepos(task, ctx) {
  const lines = [`## context repo`, ''];
  lines.push(`- **地址**：${ctx.raw || '(未配置)'}`);
  lines.push(`- **本地位置**（统一从这里访问）：${ctx.mount}`);
  if (task.baselineBranch) lines.push(`- **分支**：${task.baselineBranch}`);
  if (task.baselineSha) lines.push(`- **基线 commit**：${task.baselineSha}`);
  lines.push('');
  lines.push(
    'Foreman 只看这个仓库。它**不会去读你实际改动的代码仓库** —— ' +
      '你干了什么，必须由你自己写进这里，Foreman 才知道。',
  );
  lines.push('');
  return lines.join('\n');
}

function renderContextSetup(ctx) {
  const how = ctx.isUrl
    ? `它是一个 git 地址，直接 clone 到本地位置：

        git clone ${ctx.raw} ${ctx.mount}`
    : `它是一个本地路径，做一个软链到本地位置：

        ln -s ${ctx.local || ctx.raw} ${ctx.mount}`;

  const pushNote = ctx.isGit
    ? `
### context repo 要及时提交推送

**只要往 context repo 写了东西（状态更新、交接文档、新知识条目），就及时 commit 并 push。**
不要攒到最后，也不要只留在本地 —— 它是跨任务共享的，留在本地等于没沉淀下来。
而且 Foreman 就是靠这些 commit 来核实你的进展的，**攒着不提交等于在 Foreman 眼里什么都没干**。

    git -C ${ctx.mount} add -A
    git -C ${ctx.mount} commit -m "说明这次记录了什么"
    git -C ${ctx.mount} push

如果 push 失败（没配 SSH key、没权限），**不要静默忽略** ——
在 HANDOFF.md 的「未完成 / 已知问题」里写清楚。
`
    : `
### 注意：context repo 当前不是 git 仓库

它不是 git 仓库，Foreman 无法用 commit 核实你的产出。文件照常写，但请在 HANDOFF.md 里
说明这一点，让下一个接手的人知道没有版本历史可查。
`;

  return `### 先把 context repo 接到本地位置

context 统一从这个固定的本地位置访问：\`${ctx.mountRel}\`（绝对路径 \`${ctx.mount}\`）。

**动手之前先检查它是否已经存在：**

    ls -ld ${ctx.mount}

- **已存在** → 直接用，不要重复创建、不要覆盖
- **不存在** → ${how}

当前状态（Foreman 生成本提示词时的探测结果）：${
    ctx.mountExists ? '**已存在**，直接用即可' : '**不存在**，需要你按上面的方式创建'
  }

接好之后，仓库结构是：

    ${ctx.mountRel}/
    ├── base/       通用知识，跨项目复用
    ├── projects/   项目知识，按项目分目录
    └── tasks/      任务记录，按任务 id 分目录

如果某个目录还不存在，按需创建即可。
${pushNote}`;
}

function renderProtocol(task, ctx) {
  const dir = signalDirRelative(task.id);
  return `## 协作规范（必须遵守）

本次任务由 Foreman 监管。**Foreman 不是 AI，它不会读你的代码、不会自己分析改动**，
它只是一个程序，把你写进 context repo 的内容渲染出来给人看。
所以：你做了什么、改了哪些文件、为什么这么改，**都必须由你写成文字**，否则在 Foreman 里等于没发生。

Foreman 不会替你创建任何文件，下面这些全部由你自己创建和维护。

${renderContextSetup(ctx)}
### 任务文件位置

在 context repo 内建立以下目录，文件都放在里面：

    ${dir}/
    ├── TASK.md      任务契约：背景、目标、验收标准、能做/不能做
    ├── TODO.md      待办清单
    ├── STATUS.json  当前状态（供 Foreman 机器读取）
    └── HANDOFF.md   交接文档

### STATUS.json 格式

    {
      "task_id": "${task.id}",
      "state": "working | done | awaiting_review | awaiting_input | failed",
      "updated_at": "ISO-8601 时间戳",
      "reason": "state=failed 时必填",
      "question": "state=awaiting_input 时必填"
    }

state 取值：

| 值 | 含义 |
|---|---|
| \`working\` | 正在干活 |
| \`done\` | 整个任务完成，你不打算继续 |
| \`awaiting_review\` | 阶段性完成，需要人确认后才继续 |
| \`awaiting_input\` | 卡住了，必须先得到回答才能继续，用 \`question\` 写清在等什么 |
| \`failed\` | 放弃，必须用 \`reason\` 写清卡在哪、试过哪些方案 |

**每完成一步就更新 STATUS.json 和 TODO.md，并 commit。**
中途没有更新，Foreman 就无法区分你还在干活还是已经挂了。

### TODO.md 格式

用 checkbox 维护，完成就勾掉，不要删条目（删掉就看不出做过什么）：

    - [x] 已完成的事
    - [ ] 未完成的事

### HANDOFF.md 要求

必须包含下面 5 个一级标题，每个都不能为空。按**交给下一个 agent 接手**的标准写：
接手者没有你的上下文，不能靠猜。

    # 目标与现状
    # 已改动
    # 关键决策与理由
    # 未完成 / 已知问题
    # 验证方式

**「已改动」是重点。** Foreman 看不到你的代码，这一段是唯一的信息来源。
每个动过的文件都要写清三件事：

    ## <文件路径>
    - 改了什么：具体做了什么修改
    - 为什么：为什么需要这个改动
    - 意义/影响：它带来什么效果、影响到哪些别的部分

其余要求：

- 「关键决策与理由」写做了什么选择、为什么、否决了哪些方案，以及"看起来像 bug 其实是故意"的陷阱
- 「未完成 / 已知问题」明确列出，并给出下一个具体动作
- 「验证方式」必须给出**可执行命令和预期输出**，不能只写"跑一下测试"
- **不要贴原始 diff**，用文字说清楚
- **不要写成流水账**，不需要复述过程

Foreman 会校验这 5 个段落是否齐全、是否为空、「验证方式」里是否包含可执行命令。
不合格的交接文档会让任务被判为**存疑**，即使你声明了完成。

### 关于"完成"

Foreman 不采信自我汇报。你声明 \`done\` 之后，它会检查基线 commit 之后 context repo 里
是否真的有提交产出。**声明完成但什么都没写、没提交，会被标成存疑。**
本次任务的基线 commit 是 \`${task.baselineSha || '(未记录)'}\`。

### 改动明细（只在被要求时才写）

平时不需要写 \`CHANGES.md\`。当人明确要求"说明具体改了什么"时，
再在任务目录下写一份 \`CHANGES.md\`，格式和上面「已改动」相同，但要更详细。
写完记得 commit，Foreman 会把它渲染出来。

### 知识库使用

先看上面的索引，**只读你确实需要的条目，不要全量读**。

过程中如果出现值得沉淀的通用信息（可复用的约定、踩过的坑、环境特性），
把它写成新条目加进 context repo：通用的放 \`base/\`，项目相关的放 \`projects/<项目名>/\`。
一次性的临时结论不要写进 \`base/\`。
`;
}

/** 四部分拼接：知识库索引 + 任务信息 + context repo 信息 + 协作规范。 */
export async function buildPrompt(task, ctx) {
  const settings = await readSettings();
  const context = ctx || (await contextState());
  const index = await knowledgeIndex(context.mount);
  const values = {
    '{{RULES}}': (settings.agentRules || '').trim(),
    '{{KNOWLEDGE_INDEX}}': renderKnowledgeIndex(index),
    '{{TASK_INFO}}': renderTaskInfo(task),
    '{{REPOS}}': renderRepos(task, context),
    '{{PROTOCOL}}': renderProtocol(task, context),
  };
  let out = settings.promptTemplate || '';
  for (const ph of PLACEHOLDERS) {
    out = out.split(ph).join(values[ph] ?? '');
  }
  return out.replace(/\n{4,}/g, '\n\n\n').trim() + '\n';
}

/**
 * 设置页预览用：拿一个示例任务拼一份完整提示词，
 * 让使用者能看见 {{PROTOCOL}} 这类生成内容到底长什么样。
 */
export async function previewPrompt() {
  const sample = {
    id: 't20260101-090000-0000',
    title: '（示例任务）给登录接口加限流',
    goal: '给 /login 接口加上按 IP 的限流，避免被暴力破解。',
    background: '最近日志里出现大量失败登录尝试。',
    acceptance: '同一 IP 每分钟超过 10 次请求返回 429，并有对应测试。',
    constraints: '不要改动认证逻辑本身；不要引入新的中间件框架。',
    baselineSha: '0123456789abcdef0123456789abcdef01234567',
    baselineBranch: 'main',
    createdAt: new Date().toISOString(),
  };
  return buildPrompt(sample);
}

/**
 * 追加提示词：由人主动发起，要求 agent 补一份改动明细。
 * Foreman 自己不分析代码，只能让 agent 说明；人把这段贴回 agent 会话即可。
 */
export function changeReportPrompt(task) {
  const dir = signalDirRelative(task.id);
  return `请补一份本次任务的改动明细。

写到 context repo 的 \`${dir}/CHANGES.md\`，每个动过的文件一节：

    ## <文件路径>
    - 改了什么：具体做了什么修改
    - 为什么：为什么需要这个改动
    - 意义/影响：它带来什么效果、影响到哪些别的部分

要求：

- 不要贴原始 diff，用文字讲清楚
- 逐个文件写，不要笼统概括成一句"优化了若干代码"
- 如果某个改动是为了绕开别的问题，说明被绕开的是什么
- 写完 commit 并 push，Foreman 才能读到

任务 id：${task.id}
`;
}
