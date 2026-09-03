import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { HOST, PORT, PUBLIC_DIR, ensureDirs } from './config.js';
import * as store from './store.js';
import * as git from './git.js';
import { inspect, contextState } from './verify.js';
import { buildPrompt, changeReportPrompt, previewPrompt } from './prompt.js';
import { knowledgeIndex } from './knowledge.js';
import { listDir, makeDir } from './browse.js';
import { appendMessage } from './messages.js';
import { DEFAULT_PROMPT_TEMPLATE, DEFAULT_AGENT_RULES } from './prompt-template.js';
import { boardPage } from './views/board.js';
import { newTaskPage } from './views/new.js';
import { taskPage, changeReportPage } from './views/task.js';
import { settingsPage } from './views/settings.js';

const MAX_BODY = 1024 * 1024; // 1MB，表单足够

function html(res, body, status = 200) {
  res.writeHead(status, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(body);
}

function text(res, body, status = 200) {
  res.writeHead(status, {
    'content-type': 'text/plain; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(body);
}

function redirect(res, location) {
  res.writeHead(302, { location });
  res.end();
}

function json(res, obj, status = 200) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(JSON.stringify(obj));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error('请求体过大'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function parseForm(raw) {
  const params = new URLSearchParams(raw);
  const out = {};
  for (const [k, v] of params.entries()) out[k] = v;
  return out;
}

const STATIC_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
};

async function serveStatic(res, name) {
  // 只允许 PUBLIC_DIR 下的单层文件名，且解析后必须仍在 PUBLIC_DIR 内，防目录穿越
  const safe = path.basename(name);
  const ext = path.extname(safe);
  if (!STATIC_TYPES[ext]) return text(res, 'Not found', 404);
  const full = path.join(PUBLIC_DIR, safe);
  if (!full.startsWith(PUBLIC_DIR + path.sep)) return text(res, 'Not found', 404);
  try {
    const buf = await fs.readFile(full);
    res.writeHead(200, { 'content-type': STATIC_TYPES[ext], 'cache-control': 'no-cache' });
    res.end(buf);
  } catch {
    text(res, 'Not found', 404);
  }
}

async function handleBoard(res) {
  const context = await contextState();
  const tasks = await store.listTasks();
  const inspections = await Promise.all(tasks.map((t) => inspect(t, context)));
  html(res, boardPage(inspections, context));
}

async function handleNewForm(res, values, error) {
  const context = await contextState();
  html(res, newTaskPage({ values: values || {}, context, warnings: context.warnings, error }));
}

async function handleCreate(req, res) {
  const form = parseForm(await readBody(req));
  const values = {
    title: (form.title || '').trim(),
    goal: (form.goal || '').trim(),
    background: (form.background || '').trim(),
    acceptance: (form.acceptance || '').trim(),
    constraints: (form.constraints || '').trim(),
  };

  if (!values.title) return handleNewForm(res, values, '任务标题不能为空');
  if (!values.goal) return handleNewForm(res, values, '目标不能为空');

  // context 未就位或不是 git 仓库时不阻止创建，只是记不到基线 commit，
  // 详情页会给出「无法核实」的说明。
  const context = await contextState();
  let baselineSha = '';
  let baselineBranch = '';
  if (context.mountIsGit) {
    try {
      baselineSha = await git.headSha(context.mount);
      baselineBranch = await git.currentBranch(context.mount);
    } catch {
      baselineSha = '';
    }
  }

  const task = await store.createTask({ ...values, baselineSha, baselineBranch });
  await store.savePrompt(task.id, await buildPrompt(task, context));
  redirect(res, `/tasks/${encodeURIComponent(task.id)}`);
}

async function handleTask(res, id) {
  const task = await store.getTask(id);
  if (!task) return text(res, '任务不存在', 404);
  const context = await contextState();
  const inspection = await inspect(task, context);
  // 提示词每次按当前模板与知识库重新生成，保证设置改动能立刻体现
  const prompt = await buildPrompt(task, context);
  await store.savePrompt(task.id, prompt);
  html(res, taskPage({ inspection, prompt }));
}

async function handleChangeReport(res, id) {
  const task = await store.getTask(id);
  if (!task) return text(res, '任务不存在', 404);
  html(res, changeReportPage({ task, prompt: changeReportPrompt(task) }));
}

async function handleReply(req, res, id) {
  const task = await store.getTask(id);
  if (!task) return text(res, '任务不存在', 404);
  const form = parseForm(await readBody(req));
  const target = `/tasks/${encodeURIComponent(id)}`;
  const context = await contextState();
  if (!context.mountExists) {
    return text(res, `context 本地位置还不存在（${context.mountRel}），无法写入留言`, 400);
  }
  try {
    // 只追加 MESSAGES.md，绝不触碰 STATUS.json —— 状态必须由 agent 自己声明
    await appendMessage(id, 'human', form.text);
    redirect(res, target);
  } catch (e) {
    text(res, `留言失败：${e.message}`, 400);
  }
}

async function handlePatch(res, id, sha) {
  const task = await store.getTask(id);
  if (!task) return text(res, '任务不存在', 404);
  const context = await contextState();
  if (!context.mountIsGit) return text(res, 'context repo 不可用', 400);
  try {
    text(res, await git.commitPatch(context.mount, sha));
  } catch (e) {
    text(res, `读取 diff 失败：${e.message}`, 400);
  }
}

async function handleSettings(res, saved = false) {
  const settings = await store.readSettings();
  const context = await contextState();
  const knowledge = await knowledgeIndex(context.mount);
  const preview = await previewPrompt();
  html(res, settingsPage({ settings, knowledge, context, preview, saved }));
}

async function handleSaveSettings(req, res) {
  const form = parseForm(await readBody(req));
  if (form.reset === '1') {
    await store.writeSettings({ promptTemplate: DEFAULT_PROMPT_TEMPLATE });
  } else if (form.resetRules === '1') {
    await store.writeSettings({ agentRules: DEFAULT_AGENT_RULES });
  } else if (form.saveRules === '1') {
    await store.writeSettings({ agentRules: form.agentRules ?? '' });
  } else if (form.saveContext === '1') {
    await store.writeSettings({ contextRepo: (form.contextRepo || '').trim() });
  } else {
    await store.writeSettings({ promptTemplate: form.promptTemplate ?? '' });
  }
  redirect(res, '/settings?saved=1');
}

async function handleBrowse(res, p) {
  try {
    json(res, await listDir(p));
  } catch (e) {
    json(res, { error: e.message }, 400);
  }
}

async function handleMkdir(req, res) {
  const form = parseForm(await readBody(req));
  try {
    json(res, await makeDir(form.parent, form.name, form.gitInit === '1'));
  } catch (e) {
    const msg = e.code === 'EEXIST' ? '该目录已存在' : e.message;
    json(res, { error: msg }, 400);
  }
}

const server = http.createServer(async (req, res) => {
  let url;
  try {
    url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  } catch {
    return text(res, 'Bad request', 400);
  }
  const pathname = decodeURIComponent(url.pathname);
  const method = req.method || 'GET';

  try {
    if (pathname === '/favicon.ico') {
      res.writeHead(204);
      return res.end();
    }
    if (pathname.startsWith('/static/')) {
      return serveStatic(res, pathname.slice('/static/'.length));
    }
    if (method === 'GET' && pathname === '/') return handleBoard(res);
    if (method === 'GET' && pathname === '/api/browse') {
      return handleBrowse(res, url.searchParams.get('path'));
    }
    if (method === 'POST' && pathname === '/api/mkdir') return handleMkdir(req, res);
    if (method === 'GET' && pathname === '/tasks/new') return handleNewForm(res, null, '');
    if (method === 'POST' && pathname === '/tasks') return handleCreate(req, res);
    if (method === 'GET' && pathname === '/settings') {
      return handleSettings(res, url.searchParams.get('saved') === '1');
    }
    if (method === 'POST' && pathname === '/settings') return handleSaveSettings(req, res);

    const reportMatch = /^\/tasks\/([^/]+)\/change-report$/.exec(pathname);
    if (method === 'GET' && reportMatch) return handleChangeReport(res, reportMatch[1]);

    const replyMatch = /^\/tasks\/([^/]+)\/reply$/.exec(pathname);
    if (method === 'POST' && replyMatch) return handleReply(req, res, replyMatch[1]);

    const patchMatch = /^\/tasks\/([^/]+)\/commits\/([^/]+)$/.exec(pathname);
    if (method === 'GET' && patchMatch) return handlePatch(res, patchMatch[1], patchMatch[2]);

    const taskMatch = /^\/tasks\/([^/]+)$/.exec(pathname);
    if (method === 'GET' && taskMatch) return handleTask(res, taskMatch[1]);

    return text(res, 'Not found', 404);
  } catch (e) {
    console.error('[foreman] 请求处理出错', pathname, e);
    return text(res, `服务器错误：${e.message}`, 500);
  }
});

ensureDirs();
server.listen(PORT, HOST, () => {
  console.log(`[foreman] http://${HOST}:${PORT}`);
  console.log('[foreman] 无鉴权，默认仅监听回环地址；不要暴露到公网。');
});
