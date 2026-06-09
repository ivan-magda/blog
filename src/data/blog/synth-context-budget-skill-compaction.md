---
title: "The Context Window Is a Budget: Skill Loading, Compaction, and the Economics of Agent Memory"
author: "Ivan Magda"
pubDatetime: 2026-06-03T10:00:00Z
slug: "synth-context-budget-skill-compaction"
featured: false
draft: false
tags:
  - ai-agents
  - context-engineering
  - claude-code
description: "Why treating the context window as a finite budget — rather than an infinite scratchpad — changes how you design skill loading and compaction together."
---

Every token in a language model's context window costs something. It costs money at inference time, attention capacity during generation, and instruction-following quality across the whole session. Most agent architectures treat the context window as a scratchpad — dump things in, never clean up, hope the model stays coherent. The insight that emerges from holding skill loading and compaction together is that this is the wrong mental model. The context window is a budget, and the agent should manage it with the discipline of a memory allocator.

## Two sides of the same balance sheet

Skill loading and compaction appear to solve opposite problems: skill loading *adds* tokens to the context (injecting knowledge when the model needs it), and compaction *removes* tokens (summarizing history to free capacity). But they are two levers on the same resource. A skill body that loads fully and never leaves is a memory leak. A compaction that fires too aggressively and discards a freshly loaded skill body wastes the load cost entirely.

The right frame is a budget with inflows and outflows:

- **Inflow**: system prompt + conversation history + tool results + lazily loaded skill bodies
- **Outflow**: micro-compaction of stale tool results + auto-compaction summaries + manual compact calls

When these two sides are designed independently — as most implementations do — you get a leaky budget. The agent in the [skill-loading guide](/posts/s05-skill-loading/) loads a `code-review` skill body into the messages array as a tool result. That body stays in context for the rest of the session, even turns where code review is irrelevant. When auto-compaction eventually fires, the LLM-generated summary may or may not preserve the skill's key constraints — the summary algorithm doesn't know that `<skill name="code-review">...</skill>` is load-bearing, so it treats it as ordinary content eligible for compression.

## The two-layer injection strategy and its budget implications

The two-layer approach — cheap description in the system prompt, full body delivered on demand as a tool result — is the right architecture for managing inflow. Anthropic's [context engineering guidance](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents) frames this as putting "information in context only when the agent needs it." But the delivery mechanism creates a budget interaction that is rarely made explicit.

A skill body delivered as a tool result occupies the *end* of the messages array — the highest-salience region for transformer attention. The model reads it, uses it, and the turn completes. On the next turn, that tool result is now history. Micro-compaction (the quiet layer that trims old tool results) may replace its content with `"[Previous: used load_skill]"`. This is efficient for tool call overhead, but it silently discards the skill knowledge. If the model needs it again two turns later, it must call `load_skill` a second time — which is the correct behavior, but only if the system is designed to expect it.

The budget implication: **skill bodies are transient, not persistent**. Designing the system to treat loaded knowledge as permanent is a budget error. The correct model is closer to a cache with an eviction policy than to a loaded library. Anthropic's [compaction documentation](https://platform.claude.com/docs/en/build-with-claude/compaction) formalizes this: the server-side summarization that fires when input tokens exceed the configured trigger threshold produces a compaction block that replaces the prior conversation — meaning any skill body loaded before the threshold is no longer in scope for subsequent turns.

Research on budget-aware context management formalizes exactly this intuition. The [ContextBudget paper (arxiv:2604.01664)](https://arxiv.org/abs/2604.01664) frames context management as a sequential decision problem with an explicit budget constraint: at each step, the agent assesses remaining capacity before incorporating new observations and decides how aggressively to compress history. This is precisely the interaction between skill loading (an inflow decision) and compaction (an outflow decision) — they need to be made jointly, not independently.

## What compaction destroys — and what survives

The [Contextual Memory Virtualisation paper (arxiv:2602.22402)](https://arxiv.org/abs/2602.22402) proposes DAG-based, structurally lossless trimming as an alternative to lossy summarization, reporting token reductions averaging 20% and reaching 86% on sessions with heavy overhead. The contrast it draws is the relevant one here: lossy autocompaction can collapse an entire session's accumulated state into a short summary, and for an agent that loaded a skill body mid-session, that skill's full content is exactly the kind of detail such a summary discards.

What the LLM-generated summary *does* preserve is task state: what was accomplished, current file paths, key decisions. What it loses is fine-grained procedural knowledge — the exact checklist in a code-review skill, the nuanced edge-case handling in a deployment workflow guide. After auto-compaction fires, the model's behavior will subtly regress toward its base training distribution for that domain, away from the skill-injected specifics.

This has a practical design consequence: **skills that encode critical constraints should be re-loaded after compaction fires**. The compact tool's optional `focus` parameter exists for exactly this use case — the model can call `compact` with `focus: "preserve code-review constraints and active task"` to bias the summary toward retaining that content. But even with focus guidance, a summary is a lossy projection.

The durable alternative is to move critical skill content out of the context entirely — into the task system described in the [task-system guide](/posts/s07-task-system/), where a task's `description` field can hold a reference or a key constraint snippet that survives compaction because it lives on the filesystem, not in the messages array. This is the synthesis: the context window handles transient working memory; durable storage (tasks, files) handles invariants that must survive compression.

## Practical design rules

Holding skill loading and compaction together produces three design rules that neither concept yields on its own:

**Rule 1 — Size skill bodies to your compaction threshold.** If auto-compaction fires at 50k tokens and your largest skill body is 8k tokens, a single load can consume 16% of the remaining budget before the threshold. Size skill bodies proportionally, or split large skills into focused sub-skills that can be loaded selectively.

**Rule 2 — Re-load after compaction, not before.** The natural instinct is to load skills early and trust they will persist. The budget-aware version is to treat each compaction event as a context flush and re-load only what the current subtask needs. The two-layer injection makes this cheap: the system prompt always lists available skills, and the model can decide which to re-load based on the compacted summary.

**Rule 3 — Use the task system for constraint persistence.** Anything in a skill body that the model must not forget across a compaction boundary — a required output format, a hard constraint, a checklist item — should be persisted as a task description or a written file, not trusted to survive in the messages array. The filesystem is durable; the context is not.

These rules emerge from treating the context window as a budget with explicit inflow and outflow management. Neither skill loading nor compaction, designed alone, produces them. Designed together, they make the agent's memory coherent across sessions of arbitrary length. The same budget discipline applies when adding background execution and multi-agent work to the picture — managing concurrent inflows and durable state across subagents requires the same joint design approach described in [Durable Multi-Agent Work: Subagents, Task DAGs, and Background Execution](/posts/synth-durable-multi-agent-orchestration/).
