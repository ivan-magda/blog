---
title: "The Context Window Is a Budget: Skill Loading, Compaction, and the Economics of Agent Memory"
author: "Ivan Magda"
pubDatetime: 2026-06-03T10:00:00Z
slug: "context-budget-skill-compaction"
featured: false
draft: false
hideFromFeed: true
tags:
  - ai-agents
  - context-engineering
  - claude-code
description: "Treating the context window as a finite budget rather than an infinite scratchpad changes how you design skill loading and compaction together."
---

Every token in a language model's context window has a price: money at inference time, attention capacity during generation, and instruction-following quality across the session. Most agent architectures treat the window as a scratchpad, dumping things in and never cleaning up, hoping the model stays coherent. That model breaks down once you hold skill loading and compaction together. The context window is a budget, and the agent should manage it with the discipline of a memory allocator.

## Two sides of the same balance sheet

Skill loading and compaction look like opposite problems. Skill loading adds tokens to the context, injecting knowledge when the model needs it. Compaction removes tokens, summarizing history to free capacity. They are two levers on the same resource. A skill body that loads fully and never leaves is a memory leak. A compaction that fires too aggressively and discards a freshly loaded skill body wastes the load cost.

Picture a budget with inflows and outflows:

- **Inflow**: system prompt + conversation history + tool results + lazily loaded skill bodies
- **Outflow**: micro-compaction of stale tool results + auto-compaction summaries + manual compact calls

Design the two sides independently, as most implementations do, and the budget leaks. The agent in the [skill-loading guide](/posts/s05-skill-loading/) loads a `code-review` skill body into the messages array as a tool result. That body stays in context for the rest of the session, including turns where code review is irrelevant. When auto-compaction fires, the LLM-generated summary may or may not keep the skill's key constraints. The summary algorithm has no idea that `<skill name="code-review">...</skill>` is load-bearing, so it treats the body as ordinary content eligible for compression.

## The two-layer injection strategy and its budget implications

The two-layer approach puts a cheap description in the system prompt and delivers the full body on demand as a tool result, which is the right architecture for managing inflow. Anthropic's [context engineering guidance](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents) frames this as putting "information in context only when the agent needs it." The delivery mechanism creates a budget interaction that few implementations make explicit.

A skill body delivered as a tool result sits at the end of the messages array, the highest-salience region for transformer attention. The model reads it, uses it, and the turn completes. On the next turn, that tool result is history. Micro-compaction, the quiet layer that trims old tool results, may replace its content with `"[Previous: used load_skill]"`. That trims tool-call overhead and drops the skill knowledge with it. If the model needs the skill again two turns later, it calls `load_skill` a second time, which is correct behavior as long as the system expects it.

The budget implication: **skill bodies are transient, not persistent**. Treating loaded knowledge as permanent is a budget error. The right model is a cache with an eviction policy, not a loaded library. Anthropic's [compaction documentation](https://platform.claude.com/docs/en/build-with-claude/compaction) makes this concrete: server-side summarization fires when input tokens exceed the configured trigger threshold and produces a compaction block that replaces the prior conversation, so any skill body loaded before the threshold leaves scope for later turns.

Research on budget-aware context management formalizes this intuition. The [ContextBudget paper (arxiv:2604.01664)](https://arxiv.org/abs/2604.01664) frames context management as a sequential decision problem with an explicit budget constraint: at each step, the agent assesses remaining capacity before taking in new observations and decides how hard to compress history. That is the interaction between skill loading, an inflow decision, and compaction, an outflow decision. The two decisions have to be made together, not in isolation.

## What compaction destroys, and what survives

The [Contextual Memory Virtualisation paper (arxiv:2602.22402)](https://arxiv.org/abs/2602.22402) proposes DAG-based, structurally lossless trimming as an alternative to lossy summarization, reporting token reductions averaging 20% and reaching 86% on sessions with heavy overhead. The contrast it draws matters here: lossy autocompaction can collapse a whole session's accumulated state into a short summary, and for an agent that loaded a skill body mid-session, that skill's full content is the kind of detail such a summary discards.

The LLM-generated summary preserves task state: what got done, current file paths, key decisions. It loses fine-grained procedural knowledge, the exact checklist in a code-review skill or the edge-case handling in a deployment workflow guide. After auto-compaction fires, the model's behavior regresses toward its base training distribution for that domain, away from the skill-injected specifics.

This has a practical design consequence: **skills that encode critical constraints should be re-loaded after compaction fires**. The compact tool's optional `focus` parameter exists for this case. The model can call `compact` with `focus: "preserve code-review constraints and active task"` to bias the summary toward keeping that content. Even with focus guidance, a summary stays a lossy projection.

The durable alternative moves critical skill content out of the context and into the task system from the [task-system guide](/posts/s07-task-system/), where a task's `description` field holds a reference or a key constraint snippet. That content survives compaction because it lives on the filesystem instead of the messages array. The split is clean: the context window handles transient working memory, and durable storage in tasks and files handles invariants that must survive compression.

## Practical design rules

Holding skill loading and compaction together produces three design rules that neither yields alone:

**Rule 1. Size skill bodies to your compaction threshold.** If auto-compaction fires at 50k tokens and your largest skill body is 8k tokens, a single load can eat 16% of the remaining budget before the threshold. Size skill bodies in proportion, or split large skills into focused sub-skills the model can load selectively.

**Rule 2. Re-load after compaction, not before.** The instinct is to load skills early and trust they persist. The budget-aware move treats each compaction event as a context flush and re-loads only what the current subtask needs. The two-layer injection makes this cheap: the system prompt always lists available skills, and the model picks which to re-load from the compacted summary.

**Rule 3. Use the task system for constraint persistence.** Anything in a skill body that the model must not forget across a compaction boundary, such as a required output format, a hard constraint, or a checklist item, belongs in a task description or a written file rather than the messages array. Filesystem state persists where context does not.

These rules come from treating the context window as a budget with explicit inflow and outflow management. Skill loading alone won't produce them, and neither will compaction alone. Designed together, they keep the agent's memory coherent across sessions of any length. The same budget discipline carries over to background execution and multi-agent work, where managing concurrent inflows and durable state across subagents takes the same joint design approach described in [Durable Multi-Agent Work: Subagents, Task DAGs, and Background Execution](/posts/durable-multi-agent-orchestration/).
