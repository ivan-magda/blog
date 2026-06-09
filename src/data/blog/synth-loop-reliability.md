---
title: "Reliability Patterns in the Agent Loop: Dispatch, Drift, and Durable Bookkeeping"
author: "Ivan Magda"
pubDatetime: 2026-06-03T09:00:00Z
slug: "loop-reliability"
featured: false
draft: false
hideFromFeed: true
tags:
  - ai-agents
  - context-engineering
  - claude-code
description: "The agent loop, tool dispatch, and task tracking are three separate concerns that share one reliability problem, visible only when you hold them together."
---

The agent loop runs one invariant: call the API, check the stop reason, execute tools, append results, repeat. That invariant is easy to state and easy to implement. It gets hard to rely on in production because failures compound across turns. A tool that returns a malformed result contaminates the messages array, which the model rereads on every later turn. Task tracking drift pushes the model to repeat completed steps or skip blocked ones. Reliability lives in how these three parts interact, so you have to hold the agent loop, tool dispatch, and task tracking together to see it.

## Where the loop is robust and where it isn't

The core agent loop in the [loop guide](/posts/s01-the-agent-loop/) is robust at the structural level: it handles every valid API response, maintains the alternating user/assistant message format, and exits cleanly on `end_turn`. It stays fragile against semantic drift, the gradual buildup of stale or contradictory information in the messages array that pushes model behavior away from the task.

Research on coding agent failure modes ([ProcCtrlBench, arxiv:2605.20251](https://arxiv.org/abs/2605.20251)) notes that outcome-only benchmarks "provide limited visibility and often miss defects that arise during execution," the process-level failures that surface mid-trajectory rather than at the endpoint. The loop runs correctly through all of them. The failure is context accumulation: the loop keeps running, the model keeps calling tools, and the work stops converging.

The ReAct framework ([Yao et al., arxiv:2210.03629](https://arxiv.org/abs/2210.03629)) showed that combining explicit reasoning traces with action execution beats acting without reasoning. Even with interleaved thought traces, the loop-level failure persists: once the messages array grows long enough to bury relevant context, the model's reasoning quality drops regardless of format. The loop structure is necessary for reliability but not sufficient.

## Tool dispatch and the error injection problem

The dispatch dictionary in the [tool dispatch guide](/posts/s02-tool-dispatch/) maps tool names to handlers and returns `Result<String, ToolError>`. Every tool call produces a `toolResult` block that lands in the messages array. The architecture is right, and it carries a cost: every tool error is a permanent injection into the working context.

When a tool handler fails and returns `isError: true`, the loop appends the error to the messages array like any successful result. The model reads it, acknowledges it, and adjusts when it can. The error stays. Across a long session with several transient errors, such as network timeouts, file permission issues, and wrong paths, the messages array accumulates a trail of failures that the model keeps reasoning around. Each error adds noise, and enough noise drifts the model toward repetitive retries or makes it misattribute past errors to the current step.

The [Robust Tool Use via Fission-GRPO paper (arxiv:2601.15625)](https://arxiv.org/abs/2601.15625) documents that "after a tool-call error, smaller models often fall into repetitive invalid re-invocations" rather than learning from the feedback. Models struggle to interpret error feedback, diagnose the root cause, and change strategy instead of retrying the same failing call. The structural fix is to make transient errors cheap to recover from. Micro-compaction replaces old tool results with `[Previous: used tool_name]`, which suppresses stale error messages as they age out of the `keepRecent` window and cuts the noise load on later turns. Concurrency adds its own hazard here: `BackgroundManager`, the one manager that faces concurrent mutation, relies on Swift's [actor model](https://docs.swift.org/swift-book/documentation/the-swift-programming-language/concurrency/) for structural isolation rather than manual locks that would themselves be a reliability risk.

A deeper issue sits underneath. The dispatch dictionary uses a denylist for subagent tool access rather than a per-error recovery policy. When a model in a subagent hallucinates a call to a denied tool (say, `agent` inside a subagent), dispatch returns a `tool is not allowed in this context` error. The model reads that error as feedback and may retry with a modified prompt, burning turns on a structural limit rather than a task problem. Writing tool definitions with clear scope signals in their `description` fields cuts hallucinated-tool errors at the source, before the loop processes them.

## Task tracking as a reliability signal

The `TodoManager` in the [task tracking guide](/posts/s03-self-managed-task-tracking/) serves a reliability function that hides behind its surface job. The nag mechanism appends "Update your todos" to tool results when the model goes too many turns without touching the checklist. Its purpose is convergence, not completeness of the list.

When the model updates a todo item, it signals progress toward a defined intermediate goal. When it stops updating todos for several turns while still calling tools, the gap between todo state and the tool-call sequence flags drift early. The nag forces the model to re-anchor to its plan before that drift grows deep enough to need a hard restart.

This works alongside the loop's `iteration > config.maxIterations` guard. The iteration limit is a hard ceiling for subagents (30 iterations), but for the main agent it runs unbounded. In long main-agent sessions, the todo nag adds a soft reliability floor through regular re-anchoring to the plan, which the iteration limit alone never provides.

The tie to tool dispatch: todo updates are themselves tool calls (the `todo` tool), which produce tool results, which get micro-compacted. A model that updates todos often generates small, regular `toolResult` blocks for the `todo` tool. Those blocks are cheap and act as plan checkpoints in the message history. When auto-compaction fires, the LLM-generated summary tends to preserve task progress because it sits in the messages array as recent, explicit state.

## The compound reliability property

The agent loop, tool dispatch, and task tracking each address a distinct reliability failure mode, and only together do they cover the space:

- The loop handles **structural reliability**: correct API protocol, message alternation, stop reason handling.
- Tool dispatch handles **execution reliability**: guarded tool access, error isolation, subagent scope enforcement.
- Task tracking handles **convergence reliability**: plan adherence, progress signaling, drift detection.

Any two without the third leaves a gap. A loop with dispatch but no task tracking can execute indefinitely without converging. A loop with task tracking but no dispatch guards can loop on hallucinated tool calls. Dispatch with task tracking but no loop reliability leaves the API protocol fragile.

Anthropic's [context engineering guidance](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents) frames the core challenge as managing "what information the model has available at each step," not only what the model can do. Task tracking is context management for the task plan, the same way micro-compaction is context management for tool results. Both keep the model's working context focused on what matters this turn. The loop is where they converge, the one place where protocol correctness, tool execution scope, and task plan state all have to stay coherent at once. Designing them independently and composing at the loop boundary keeps the kernel steady as capabilities grow. The same composability holds when skill loading and compaction put the context budget under pressure: [The Context Window Is a Budget](/posts/context-budget-skill-compaction/) traces how those budget constraints interact with each layer.
