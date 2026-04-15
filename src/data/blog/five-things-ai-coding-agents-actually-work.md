---
title: "Five Things I Learned About Making AI Coding Agents Actually Work"
author: "Ivan Magda"
pubDatetime: 2026-04-15T14:39:11Z
slug: "five-things-ai-coding-agents-actually-work"
featured: true
draft: false
tags:
  - ai-agents
  - claude-code
description: "The biggest gains in AI agent performance come from the system around the model, not the model itself."
---

Let's say we've been using an AI coding agent for a few weeks. The first sessions felt magical — we described a feature, the agent built it, and everything worked. But over time, something shifted. The agent started ignoring our project conventions. It began reading files it had already seen. Sessions that used to produce clean code now ended with us manually fixing half the output.

The instinct is to blame the model. But the research points somewhere else entirely. [A study by Meta and Harvard](https://arxiv.org/abs/2512.10398) found that Claude Sonnet with well-designed scaffolding outperformed Claude Opus under identical conditions on a standardized benchmark. The model wasn't the bottleneck — the system around it was.

That system — the instruction files, the project structure, the session management, the way we formulate tasks — is what the industry calls _scaffolding_. In this post, let's walk through five lessons about scaffolding that changed how our agents perform, each backed by research and official documentation.

## Keep instruction files compact

Every AI coding tool has some version of a project instruction file — CLAUDE.md for Claude Code, `.cursor/rules/` for Cursor, `.windsurfrules` for Windsurf. These files are loaded at the very beginning of the agent's context window, which means the model reads them with maximum attention.

However, there's a trap here. As we work with an agent and it keeps making the same mistakes, the natural reaction is to add more rules. One more convention. One more "IMPORTANT: never do X." Before long, the file balloons into a wall of text — and paradoxically, the agent starts ignoring _more_ instructions, not fewer.

The reason traces to a well-documented phenomenon in transformer models called the ["lost in the middle" problem](https://arxiv.org/abs/2307.03172). Research from Stanford and UC Berkeley showed that LLMs attend strongly to the beginning and end of their context window, with accuracy dropping over 30% for information stuck in the middle. As a session progresses and tool outputs accumulate, those carefully written instructions get pushed into exactly that dead zone.

[Anthropic's official guidance](https://code.claude.com/docs/en/best-practices) is direct: target under 200 lines per CLAUDE.md file, and Claude Code will actively warn when the file exceeds 40,000 characters. The recommended content is surprisingly narrow — bash commands the agent can't guess, code style rules that differ from defaults, testing instructions, and key architectural decisions. Everything else should live in separate files that the agent reads on demand.

Here's what a compact root CLAUDE.md might look like for a monorepo:

```markdown
# Project structure

Monorepo with three packages: `frontend/`, `backend/`, `shared/`.

## Build & test

- `pnpm install` from root
- `pnpm test` runs all packages
- `pnpm test --filter=frontend` for a single package

## Rules

- Always run tests after code changes
- For frontend work, read `frontend/CLAUDE.md` first
- For API changes, read `backend/CLAUDE.md` first
```

Note how the root file acts as a router — it tells the agent _where_ to find detailed instructions rather than cramming everything into one place. [Anthropic's documentation](https://docs.anthropic.com/en/docs/claude-code/memory) supports this pattern through the `@path/to/import` syntax (up to 5 levels deep) and the `.claude/rules/` directory with path-specific activation. (For a detailed walkthrough of applying this pattern to a real monorepo, see [Fixing the 40k CLAUDE.md warning](/posts/fixing-40k-claude-md-warning-monorepo/).)

One thing to keep in mind here is that the same pattern appears across every major tool. Cursor recommends under 500 lines per rule file with glob-based activation. Windsurf enforces a hard 6,000-character limit. GitHub Copilot caps code review instructions at 4,000 characters. The industry has converged on the same insight: instruction files are prompts, and prompts work best when they're focused.

## Structure the project so the agent can navigate it

The single most surprising finding from AI coding agent research is how agents actually spend their tokens. Independent benchmarks consistently show that 60–80% of tokens go toward _figuring out where things are_ — searching for files, reading directory structures, grepping for function names — not toward solving the actual problem.

Let's say we have a monorepo with 800 files and we ask the agent to fix a bug in the authentication flow. The agent doesn't have an IDE's "Go to Definition" — it works with three text-based tools: grep (pattern search), glob (path matching), and read (file contents). A search for `handleAuth` might return 23 matches across the codebase, each consuming tokens as the agent reads through them to find the right one. Every file read, every grep result stays in the context window, progressively diluting the signal.

This is where project structure becomes a performance lever. [An academic study](https://arxiv.org/abs/2601.20404) measured the impact directly on repositories using AGENTS.md files: 28.6% lower median runtime and 16.6% fewer output tokens while maintaining the same task completion rate. The agents spent less time exploring because they knew where to look.

The practical fix is a brief navigation map in the root instruction file. Rather than describing every file (Anthropic explicitly warns against this), we tell the agent how the project is _organized_ — which directory handles what concern, and where to find deeper documentation. For monorepos, a root CLAUDE.md that says "for email features, read `@emails/CLAUDE.md`" saves far more tokens than any model optimization.

Here's a concrete before-and-after. This is the kind of sprawling instruction file that wastes tokens:

```markdown
# CLAUDE.md (bloated — 400+ lines)

## API endpoints

POST /api/auth/login — handles user login with JWT...
POST /api/auth/refresh — refreshes expired tokens...
GET /api/users/:id — returns user profile...
... (200 more lines of endpoint descriptions)

## Database schema

users table: id, email, password_hash, created_at...
sessions table: id, user_id, token, expires_at...
... (100 more lines of schema)
```

And here's what actually helps the agent navigate:

```markdown
# CLAUDE.md (compact)

## Project layout

- `src/api/` — REST endpoints (one file per resource)
- `src/models/` — database models (Prisma schema in schema.prisma)
- `src/services/` — business logic, one service per domain
- `src/middleware/` — auth, logging, error handling

Read the relevant source files directly — don't rely on this summary.
```

The second version is shorter, but it gives the agent a mental map. When asked about authentication, it knows to look in `src/middleware/` and `src/services/`, not grep the entire tree.

## Start fresh sessions early and often

There's a strong intuition that longer sessions are better — the agent "already knows" our codebase, we don't need to re-explain anything. In practice, the opposite is true, and the research is unambiguous about why.

[Chroma's "Context Rot" study](https://research.trychroma.com/context-rot) tested 18 frontier LLMs and found that _every single model's performance degrades as input length increases_, even on straightforward tasks. The degradation often isn't gradual — models that stay reliable on short inputs can drop sharply once inputs cross certain thresholds. [A separate study](https://arxiv.org/abs/2510.05381) showed that even when models achieve perfect retrieval (100% exact match on finding information), their _reasoning_ about that information still drops 13.9–85% as context grows.

[Anthropic's own documentation](https://code.claude.com/docs/en/best-practices) is refreshingly blunt about this. Their best practices page states that "a clean session with a better prompt almost always outperforms a long session with accumulated corrections." There's no penalty for starting fresh — the agent reads CLAUDE.md at the beginning of every conversation, so it's always oriented.

Claude Code does have a compaction mechanism (triggered manually with `/compact` or automatically at ~75–95% capacity) that summarizes the conversation and replaces the full history. However, compaction has real limits. Summaries inherently lose information — full tool outputs, detailed reasoning traces, and nuanced context get compressed or dropped. And critically, when auto-compaction triggers, the model is already operating at degraded capacity, so it produces lower-quality summaries. [One GitHub issue](https://github.com/anthropics/claude-code/issues/34685) documented Claude Opus with a 1M context window where, at just 48% usage, the model itself recommended starting fresh.

If you want to learn more about how to build your own context compaction mechanism, I covered that in detail in [a previous post](/posts/s06-context-compaction/).

The practical approach that works well is structuring work into focused sprints — each session targeting a specific deliverable. Anthropic recommends an [Explore → Plan → Implement → Commit](https://code.claude.com/docs/en/best-practices) workflow where the research phase and implementation phase happen in separate sessions. The research session builds a plan file; the implementation session starts clean and executes it.

For the CLAUDE.md restructuring work I did recently on a monorepo, this meant running one session to audit the existing files and draft a restructuring plan, then a fresh session to execute the frontend refactor, and another fresh session for the root and CLI pass. Each session was focused, fast, and produced clean results — roughly 92k characters of always-loaded context reduced to ~25k across the whole project.

## Give the agent a way to verify its own work

[Anthropic calls this](https://code.claude.com/docs/en/best-practices) "the single highest-leverage thing" we can do for agent performance. The reasoning comes down to how agents work at a fundamental level — every major AI coding system runs an iterative loop of Think → Act → Observe. When the Observe step includes machine-verifiable feedback (test output, compiler errors, linter results), the agent can self-correct. Without it, _we_ become the only feedback loop, and every mistake requires our attention.

The research on self-verification is clear: external verification dramatically outperforms self-assessment. LLMs will confidently approve their own broken code. As one practitioner put it: "That's why AI is so good at coding but mediocre at writing — there's no easy way to validate creative work. But code I can compile, lint, execute, verify the output."

The difference between a well-formulated and a poorly-formulated task is almost entirely about whether the agent can check its own work. Consider the difference: "fix the login bug" gives the agent no way to know when it's done. "Users report that login fails after session timeout — check the auth flow in `src/auth/`, reproduce the issue with a failing test, then fix it and make sure all tests pass" gives the agent a concrete verification loop.

We can encode this pattern directly into CLAUDE.md so it applies to every session:

```markdown
## After code changes

- Run `npm test` — all tests must pass
- Run `npm run lint` — fix any issues
- Do NOT ask me to run tests. Run them yourself.
- If tests fail, read the output, fix the issue, re-run.
```

With that in place, the agent has a built-in feedback loop for every change it makes. [Spotify's engineering team](https://engineering.atspotify.com/2025/12/feedback-loops-background-coding-agents-part-3) took this further in their production setup — they built independent verifiers that activate based on what's in the codebase (Maven verifier triggers if `pom.xml` is found, npm verifier if `package.json` exists), so the agent always has an appropriate way to check its work without us configuring it per-task.

## When the agent fails, check the scaffolding first

When an agent produces bad output, our first instinct is usually "the model is dumb." But almost every time, the problem is in the scaffolding — and that's actually good news, because scaffolding is something we can change.

The empirical evidence for this is now substantial. [SWE-Agent](https://arxiv.org/abs/2405.15793) (Yang et al., 2024) showed that interface design alone — the commands available to the agent, the format of outputs — jumped performance from 3.8% to 12.5% on a standard benchmark. Claude 3.7's performance on the same benchmark increased from 62.3% to 70.2% with better scaffolding. GPT-4o improved from 23% to 33.2% by swapping one scaffold for another. The base model stayed the same; only the system around it changed.

When an agent starts producing poor results, a systematic diagnostic approach works far better than prompt tweaking. Check context first — is the session too long? Is the model missing key information, or is it drowning in irrelevant tool outputs? Next, check tools — are commands returning errors or unexpected data that the model is misinterpreting? Then check instructions — are prompts ambiguous, conflicting, or buried in a wall of other rules? Then check architecture — is too much crammed into a single context window? Only after all of these check out should we conclude the model itself isn't capable enough.

One thing to keep in mind here is the compound reliability problem. A 10-step agent process where each step succeeds 99% of the time still fails roughly one in ten complete runs. At 95% per step, end-to-end success drops to about 60%. This means improving _any single component's_ reliability — cleaner context, better tools, clearer instructions — has outsized impact on the whole system.

The mental model shift that helped me most was this: when the agent ignores a convention, the question isn't "why is it ignoring me?" — it's "is this instruction visible in the current context, or has it been pushed into the dead zone?" When the agent reads files it doesn't need, the question isn't "why is it wasting tokens?" — it's "does my project structure give it a clear map to the right files?" When the agent produces broken code without catching it, the question isn't "why can't it code?" — it's "did I give it a way to verify its work?"

## What it all comes down to

These five lessons share a common thread. We're not passive users who type prompts and wait for results — we're part of the system. Our CLAUDE.md, our project structure, our decision to start a new session, our way of formulating tasks — all of these are components of the scaffolding that surrounds the model. The developers who get the most from AI coding agents aren't the ones with the best prompting tricks. They're the ones who design the best systems around the model.

If you're finding that your AI coding agent is getting worse over time, the fix probably isn't a better model. It's a shorter instruction file, a cleaner project structure, a fresh session, and a test command that the agent can run on its own. The scaffolding is where the leverage lives.

Thanks for reading!
