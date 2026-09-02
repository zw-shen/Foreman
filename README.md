# Foreman

> Don't just trust your LLM — supervise it.

Foreman is a git-backed dashboard for supervising coding agents. Instead of trusting an agent's self-reported "done", Foreman inspects the actual commits in a task's repository, verifies the completion/failure signal it wrote, and requires a structured handoff note (not a raw log) before a task changes hands between agents.

[中文说明](docs/README.zh-CN.md)

## Status

Early design stage. No implementation yet.

## Core Idea

- Each task is tracked in its own git repo (a default repo per task, even if multiple agents touch it — only the result matters).
- Every finished instruction is verified at the commit level, not by trusting the agent's self-report.
- Each task carries: background, current goal, current progress, TODO/DONE lists, constraints (what it can/cannot do), and a structured handoff document.
- Handoff documents follow a template so they don't turn into a play-by-play log — they capture what's blocked, what's already been tried, and what to do next.

## License

TBD
