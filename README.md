# Foreman

> Don't just trust your LLM — supervise it.

Foreman is a git-backed dashboard for supervising coding agents. Instead of trusting an agent's self-reported "done", Foreman looks at what the agent actually left behind in a shared *context repo*: real commits, a status file in an agreed format, and a structured handoff note (not a raw log).

[中文说明](docs/README.zh-CN.md)

## Status

Early stage, but runnable. Node.js, zero npm dependencies, no database, no build step.

    npm start        # http://127.0.0.1:4600

No authentication — it binds to localhost only. Do not expose it to a network.

See [产品与功能定义](docs/PRODUCT.zh-CN.md) for the full design (Chinese).

## Core Idea

- Foreman is **not an AI**. It never calls a model, never reads your code, never analyses a diff.
  It is a program that reacts to what the agent writes down.
- There is exactly **one repository** it watches: the *context repo*, shared by all tasks.
  It holds shared knowledge, per-project knowledge, and one directory per task.
- The agent writes its own status, TODO list and handoff note into that repo, at agreed paths.
  Foreman reads them and cross-checks the claims against the repo's real git history.
- A task that claims to be done with nothing committed is flagged as **unsubstantiated** —
  that single cell on the board is the reason this tool exists.
- Because Foreman cannot see the code, the agent must **describe its changes in words**:
  for every file, what changed, why, and what it affects. Detailed change reports are pulled
  on demand — you ask, Foreman emits a follow-up prompt, the agent answers, Foreman renders it.
- Handoff notes follow a template and are linted, so they can't degrade into a play-by-play log.

## License

TBD
