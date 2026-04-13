---
title: "Fixing the 40k CLAUDE.md Warning in a Monorepo"
author: "Ivan Magda"
pubDatetime: 2026-04-14T09:00:00Z
slug: "fixing-40k-claude-md-warning-monorepo"
featured: false
draft: false
tags:
  - claude-code
  - ai-agents
  - developer-tools
description: "How we restructured Claude Code's CLAUDE.md files in a monorepo to cut 73% of always-loaded context without losing a single fact."
---

One afternoon Claude Code's status bar flashed a warning we'd been ignoring for weeks:

```
⚠ Large CLAUDE.md will impact performance (42.5k chars > 40.0k) · /memory to edit
```

The file in question — `frontend/CLAUDE.md` in our monorepo — had grown organically over three months from a lean quick-start into a 519-line reference manual. Route maps, island catalogs, env var tables, deployment config, fifteen common pitfalls, every non-obvious CSS class. It was a _good_ file. The kind of file teammates call "the source of truth." And it was now actively degrading the instruction-following quality of every conversation.

The instinct here is to start trimming — cut a few sections, move a table into a README, get back under the threshold. However, the problem isn't that the file is long. The problem is that _everything_ in it loads into context at the start of _every_ session, whether the current task needs it or not. That's not a documentation problem. That's a memory hierarchy problem.

In this post, let's look at what Anthropic's docs and community research say about structuring CLAUDE.md effectively, and then walk through how we applied those practices to bring a monorepo from ~92k characters of always-loaded context down to ~25k — a 73% reduction — without losing a single load-bearing fact.

---

## Why bloated CLAUDE.md files degrade everything

The easy reading of the 40k warning is "long files waste tokens." The real story is more interesting.

Claude Code loads every CLAUDE.md in the directory tree into context at the start of every session. The official docs at [code.claude.com/docs/en/memory](https://code.claude.com/docs/en/memory) recommend targeting under 200 lines per file and note that longer files "consume more context and may reduce adherence." One thing to keep in mind here is that CLAUDE.md content is delivered as a user message, not as part of the system prompt. The wrapper even tells Claude the content "may or may not be relevant to your tasks." When most of the file _isn't_ relevant to the current task, the agent learns to be dismissive of the whole thing.

Research cited by [HumanLayer's analysis](https://humanlayer.dev/blog/writing-a-good-claude-md) (which received 748 points on Hacker News) points to a finding that makes this worse: instruction-following quality degrades _uniformly_ as instruction count rises — not in a "lost in the middle" pattern where only the center gets ignored. A bloated file doesn't make Claude skip a few sections. It makes Claude worse at following _every_ rule in the file.

This matters especially with smaller context windows. With Opus on a 1M context window, ~92k of CLAUDE.md is about 9% of the budget — noticeable but survivable. When switching to Sonnet (which defaults to 200k in the Claude Code subscription), that same 92k plus system overhead suddenly eats around a quarter of the available context before we've typed a word. And even on Opus, every turn re-injects the CLAUDE.md content, which means more tokens consumed and usage limits reached faster.

---

## What belongs in CLAUDE.md (and what doesn't)

Before we started cutting, we spent time researching the problem properly — working through Anthropic's official memory and best-practices docs, the HumanLayer analysis on instruction-following degradation, practitioner writeups from teams using Claude Code in production, and source-code analysis of the MEMORY.md loading logic. The best practices that emerged are worth sharing because they apply to any project, not just ours.

Anthropic's [best-practices page](https://code.claude.com/docs/en/best-practices) provides a clean litmus test: _"For each line, ask: 'Would removing this cause Claude to make mistakes?' If not, cut it. Bloated CLAUDE.md files cause Claude to ignore your actual instructions!"_

**Content that belongs in CLAUDE.md:** bash commands Claude can't guess, code style rules that differ from defaults, testing instructions and preferred test runners, repository etiquette (branch naming, PR conventions), architectural decisions specific to the project, and common gotchas that cause real bugs.

**Content that doesn't belong:** anything Claude can figure out by reading code, standard language conventions, detailed API documentation (link to docs instead), information that changes frequently, long explanations or tutorials, file-by-file descriptions of the codebase, and self-evident practices like "write clean code."

The recommended trigger for adding content: add to CLAUDE.md when Claude makes the same mistake a second time, when a code review catches something Claude should have known, when we type the same correction we typed last session, or when a new teammate would need the same context. Everything else is noise.

---

## The memory hierarchy: lazy loading over front-loading

The most valuable finding from the research was understanding Claude Code's loading mechanics. Not everything loads at once — and that asymmetry is the key to keeping context lean.

Claude Code walks the directory tree from the current working directory up to the git root, loading every CLAUDE.md and CLAUDE.local.md it finds along the way. Everything in that ancestor chain loads _immediately_ at session start. However, CLAUDE.md files in _subdirectories_ load lazily — only when Claude reads a file in that directory. Sibling packages in a monorepo never cross-contaminate. If the working directory is `frontend/`, the `cli/CLAUDE.md` never loads unless Claude navigates there.

This is the escape valve. But there's a trap that looks like an escape valve and isn't.

Claude Code supports `@path/to/file.md` syntax inside CLAUDE.md for importing other files. It _looks_ like lazy loading — "reference it instead of inlining it." It's not. [Shrivu Shankar at Abnormal AI](https://blog.sshh.io/p/how-i-use-every-claude-code-feature) identifies this explicitly: `@`-imported files expand at startup and count against the context budget from turn zero. For anyone trying to slim down a CLAUDE.md, `@`-imports defeat the purpose entirely.

The mechanism that _actually_ lazy-loads is a plain-text reference — a line in CLAUDE.md that tells Claude where to find something, without importing it. The key is to make each reference a conditional trigger rather than a bare path. Here's the difference:

```markdown
## Reference Docs

- docs/routes.md
- docs/islands.md
- docs/auth-and-flows.md
```

Claude has no signal about _when_ each doc matters. The better pattern — what Shankar calls "pitching the agent on when to read" — gives each pointer a condition:

```markdown
## Reference Docs

- Before adding or modifying a route → `docs/routes.md`
- When creating or refactoring a React island → `docs/islands.md`
- When touching auth, unlock, or form persistence → `docs/auth-and-flows.md`
- Before calling a backend endpoint or handling job status → `docs/api-endpoints.md`
```

Each entry is a condition the agent evaluates against the current task. If the task doesn't involve routes, `docs/routes.md` never loads. The agent self-selects the right reference material on demand.

One more lazy-loading mechanism worth mentioning: [Skills](https://code.claude.com/docs/en/skills). A skill description (capped at 250 characters) stays in context, but the full skill body loads only when invoked. The mental model that helps: **CLAUDE.md holds facts that are always true. Skills hold procedures for specific workflows.** "We use 2-space indentation" is a fact. "How to deploy to production" is a procedure. The fact stays in CLAUDE.md. The procedure becomes a skill at `.claude/skills/deploy/SKILL.md`.

---

## Applying this to our monorepo

With the best practices mapped out, we synthesized everything into a research report with a concrete remediation plan — a migration table mapping every section of our files to one of four actions: keep inline, condense with pointer, extract to new doc, or delete. That table turned what could have been an afternoon of arguing about every section into a mechanical execution plan.

We started with the frontend package as an isolated test case. Using Claude Code's plan mode (`Shift+Tab` or `/plan`), we produced a migration plan without touching files — content migration tables, the restructured outline, and a verification strategy. We reviewed the plan, pushed back on a few choices.

The execution created 9 new docs under `frontend/docs/`, each holding content extracted from the original CLAUDE.md. Route maps, island catalogs, auth flows, API endpoints, testing inventory, deployment config — all moved to dedicated reference files with pitch-style pointers back in CLAUDE.md. The new file kept only what the agent needs on _every_ session: build commands, critical rules, key patterns, and the top pitfalls.

After execution, we verified with a code review and then implemented several features to confirm the agent still works as expected — reading the right docs on demand, following the rules, no regressions.

With the frontend validated, we applied the same approach to the root `CLAUDE.md` (29.6k / 384 lines) and `cli/CLAUDE.md` (20.4k / 336 lines). Same flow: plan, review, execute, verify. This pass also cleaned up auto-memory — Claude Code's auto-memory lives at `~/.claude/projects/<hash>/memory/` and loads the first 200 lines of `MEMORY.md` at startup. Ours had grown to 175 lines with a couple of stale entries. Small cleanup, but it reinforced the distinction: auto-memory is for patterns Claude _learns_; reference data we want to _control_ belongs in committed CLAUDE.md or `.claude/rules/` files.

---

## Results

Across two sessions, the combined always-loaded CLAUDE.md content went from ~92k characters to ~25k — a 73% reduction:

```
frontend/CLAUDE.md:  42,663 → 8,262 bytes   (−80%)
root CLAUDE.md:      29,652 → 9,356 bytes   (−68%)
cli/CLAUDE.md:       20,392 → 7,974 bytes   (−61%)
```

Every load-bearing fact is still reachable, now living in scope-colocated docs that lazy-load when the agent actually needs them. The 40k warning is gone. Token costs per turn dropped. And critically, the agent's instruction-following on what _remains_ in CLAUDE.md is noticeably better because there's less noise competing for attention.

---

## Wrapping up

Anyone who's built iOS apps will recognize this pattern. A `UIViewController` starts clean — a hundred lines of setup and a few action handlers. Over months it accumulates data sources, network calls, formatters, validation, analytics. Each addition is reasonable in isolation. The file crosses 1,000 lines. Every method competes for attention, and the cognitive cost grows superlinearly. The fix isn't deleting code — it's extracting responsibilities into focused types that the controller references when it needs them. CLAUDE.md has the same dynamics. It starts as a briefing, accumulates into an encyclopedia, and the fix is the same: extract reference content into focused docs, and let the briefing coordinate.

The key insight is a reframe: **CLAUDE.md is not documentation. It's a prompt budget.** Every line competes with every other line for the agent's attention, and the research shows that competition degrades adherence uniformly — not just for the lines at the bottom. Treat CLAUDE.md the way we'd treat a system prompt: short, specific, and loaded only with what matters on _every_ task.

If your own CLAUDE.md is approaching the 40k warning — or even the softer 200-line guidance — the process is straightforward: research the best practices, build a migration plan before touching files, use pitch-style references instead of `@`-imports, review thoroughly, and verify nothing got lost. Budget a couple of hours. It compounds — every session after the restructure runs leaner. And if the file grows back to 200 lines in six months, that's a sign the process worked and it's time for another pass. Thanks for reading!
