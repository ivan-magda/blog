---
title: "Reliability Patterns in the Agent Loop: Dispatch, Drift, and Durable Bookkeeping"
author: "Ivan Magda"
pubDatetime: 2026-06-03T09:00:00Z
slug: "synth-loop-reliability"
featured: false
draft: false
tags:
  - ai-agents
  - context-engineering
  - claude-code
description: "The agent loop, tool dispatch, and task tracking are three separate concerns — but they share a common reliability problem that only appears when you hold them together."
---

The agent loop has a deceptively simple invariant: call the API, check the stop reason, execute tools, append results, repeat. That invariant is easy to state and easy to implement. What makes it hard to *rely on* in production is that failures compound across turns. A tool that returns a malformed result doesn't just fail once — it contaminates the messages array, which the model reads on every subsequent turn. Task tracking drift doesn't just produce an inaccurate checklist — it causes the model to repeat completed steps or skip blocked ones. Understanding where reliability actually lives in the system requires holding the agent loop, tool dispatch, and task tracking together — because the failure modes of each interact with the others.

## Where the loop is robust and where it isn't

The core agent loop described in the [loop guide](/posts/s01-the-agent-loop/) is robust at the *structural* level: it correctly handles every valid API response, maintains the alternating user/assistant message format, and exits cleanly on `end_turn`. What it is not robust against is *semantic drift* — the gradual accumulation of stale or contradictory information in the messages array that causes model behavior to diverge from the intended task.

Research on coding agent failure modes ([ProcBench, arxiv:2605.20251](https://arxiv.org/html/2605.20251)) identifies that "many practically important failures arise during execution rather than at the endpoint alone, such as agents retaining stale context or repeating similar tool calls without making meaningful progress." These are not loop bugs — the loop is running correctly. They are *context accumulation* failures: the loop keeps running, the model keeps calling tools, but the work isn't converging.

The ReAct framework ([Yao et al., arxiv:2210.03629](https://arxiv.org/abs/2210.03629)) established that combining explicit reasoning traces with action execution produces better reliability than acting without reasoning. But even with interleaved thought traces, the loop-level failure mode persists: if the messages array grows long enough that relevant context is buried, the model's reasoning quality degrades regardless of the reasoning format. The loop structure is necessary but not sufficient for reliability.

## Tool dispatch and the error injection problem

The dispatch dictionary in the [tool dispatch guide](/posts/s02-tool-dispatch/) maps tool names to handlers and returns `Result<String, ToolError>`. Every tool call produces a `toolResult` block that goes into the messages array. This is the correct architecture — but it means every tool error is a *permanent injection* into the working context.

When a tool handler fails and returns `isError: true`, the error message is appended to the messages array just like a successful result. The model reads it, acknowledges it, and (ideally) adjusts. But the error stays. Over a long session with several transient errors — network timeouts, file permission issues, temporarily wrong paths — the messages array accumulates a trail of failures that the model must keep reasoning around. Each error adds noise; enough noise and the model's behavior drifts toward repetitive retry patterns or misattributes past errors to current steps.

The [Robust Tool Use via Fission-GRPO paper (arxiv:2601.15625)](https://arxiv.org/pdf/2601.15625) documents that "error recovery is a key bottleneck for smaller tool-using models in multi-turn execution." Models struggle to correctly interpret error feedback, diagnose the root cause, and adjust strategy without retrying the same failing call. Swift's actor model, documented in [the Swift concurrency guide](https://docs.swift.org/swift-book/documentation/the-swift-programming-language/concurrency/), provides structural isolation for the one manager type in the codebase that genuinely faces concurrent mutation — `BackgroundManager` — without requiring manual lock management that would itself be a reliability hazard. The structural fix is to make transient errors cheap to recover from: micro-compaction's replacement of old tool results with `[Previous: used tool_name]` naturally suppresses stale error messages as they age out of the `keepRecent` window, reducing the noise load on subsequent turns.

But there is a deeper issue: the dispatch dictionary uses a denylist for subagent tool access rather than an explicit per-error recovery policy. When a model in a subagent context hallucinates a tool call for a denied tool (say, `agent` inside a subagent), the dispatch returns a `tool is not allowed in this context` error result. The model reads that error, sees it as feedback, and may retry with a modified prompt — burning turns on a structural limitation rather than a task problem. Designing tool definitions with clear scope signals in their `description` fields reduces hallucinated-tool errors at the source, before the loop even processes them.

## Task tracking as a reliability signal

The `TodoManager` in the [task tracking guide](/posts/s03-self-managed-task-tracking/) serves a different reliability function than it might appear. The nag mechanism — appending "Update your todos" to tool results when the model goes too many turns without updating the checklist — is not about completeness of the todo list. It's a *convergence signal*.

When the model updates a todo item, it signals that it is making progress toward a defined intermediate goal. When it stops updating todos for several turns while continuing to call tools, the divergence between the todo state and the tool call sequence is an early indicator of drift. The nag forces the model to re-anchor to its plan before the drift becomes deep enough to require a hard restart.

This works in synergy with the loop's `iteration > config.maxIterations` guard. The iteration limit is a hard ceiling for subagents (30 iterations), but for the main agent it is effectively infinite. For long-running main agent sessions, the todo nag provides a soft reliability floor — regular re-anchoring to the task plan — that the iteration limit alone cannot provide.

The interaction with tool dispatch is: todo updates are themselves tool calls (`todo` tool), which produce tool results, which get micro-compacted. A model that updates its todos frequently generates small, regular `toolResult` blocks for the `todo` tool. Those blocks are cheap (short content) and serve as plan checkpoints in the message history. If auto-compaction fires, the LLM-generated summary is more likely to preserve task progress information because it appears as recent, explicit state in the messages array.

## The compound reliability property

The synthesis is that the agent loop, tool dispatch, and task tracking each address a distinct reliability failure mode — but they are only collectively sufficient:

- The loop handles **structural reliability**: correct API protocol, message alternation, stop reason handling.
- Tool dispatch handles **execution reliability**: guarded tool access, error isolation, subagent scope enforcement.
- Task tracking handles **convergence reliability**: plan adherence, progress signaling, drift detection.

Any two without the third leaves a gap. A loop with dispatch but no task tracking can execute indefinitely without converging. A loop with task tracking but no dispatch guards can loop on hallucinated tool calls. Dispatch with task tracking but no loop reliability leaves the API protocol fragile.

Anthropic's [context engineering guidance](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents) frames the core challenge as managing "what information the model has available at each step" — not just what the model can do. The reliability insight is that task tracking is *context management* for the task plan, just as micro-compaction is context management for tool results. Both are mechanisms for keeping the model's working context focused on what matters for the current turn. The loop is where these mechanisms converge: it is the only place in the system where all three concerns — protocol correctness, tool execution scope, and task plan state — must be simultaneously coherent. Designing them independently and composing at the loop boundary is what makes the kernel hold steady as capabilities grow. When the agent's context budget comes under pressure from skill loading and compaction cycles, the same composability applies — the analysis in [The Context Window Is a Budget](/posts/synth-context-budget-skill-compaction/) shows how the budget constraints interact with each layer.
