---
title: "Durable Multi-Agent Work: Subagents, Task DAGs, and Background Execution"
author: "Ivan Magda"
pubDatetime: 2026-06-03T11:00:00Z
slug: "synth-durable-multi-agent-orchestration"
featured: false
draft: false
tags:
  - ai-agents
  - context-engineering
  - claude-code
description: "How subagent isolation, a file-persisted task DAG, and background execution compose into orchestration that stays coherent across time and context boundaries."
---

Delegation and durability are orthogonal problems, and most agent architectures solve them independently. Subagents handle delegation: a child agent takes a scoped task, runs it in isolated context, and returns a summary. Task systems handle durability: plans persist to disk and survive compaction and restarts. Background execution handles concurrency: slow commands run without blocking the main loop. What becomes clear only when you treat them as a system is that they compose into something none achieves alone — multi-agent work that stays coherent across time, context boundaries, and parallel execution paths.

## The three isolation problems

Each mechanism solves a distinct isolation problem, and each creates a coordination gap when used alone.

Subagents (covered in the [subagents guide](/posts/s04-subagents/)) isolate *context*: a child agent starts with a fresh messages array, does its work, and returns only a text summary. The parent's context stays clean. But the child's work is ephemeral — when the subagent completes, its entire working history evaporates. If the parent later needs to resume, revise, or audit what the child did, there is nothing to inspect.

The task system persists *plans*: tasks are JSON files in `.tasks/`, with explicit `blockedBy`/`blocks` dependency edges. A plan written to disk survives context compaction, process restarts, and arbitrarily long sessions. But the task system is synchronous in its planning model — it tells the agent what to do and tracks whether it was done, but doesn't manage *how* the doing proceeds or which agent is responsible for which step.

Background execution parallelizes *slow work*: a command handed to `background_run` returns a job ID immediately, and the loop keeps moving. But background jobs are fire-and-forget in isolation — there is no durable record of which task they belong to, and if the agent restarts while a job is running, the completion notification is lost.

## The composition: task ownership + subagent execution + background jobs

The synthesis is to use the task DAG as the coordination layer across all three mechanisms.

Each task in the DAG has an `owner` field — anticipating multi-agent assignment. When the main agent decomposes a large plan into tasks and decides to parallelize, it can delegate task execution to subagents. The subagent receives a prompt that includes the task ID, reads the task's description via `task_get`, executes the work, and updates the status via `task_update` when done. The task DAG becomes a shared coordination surface: the main agent owns the plan structure, and subagents own individual task execution.

Background execution slots into this naturally. A subagent working on a task that requires running a slow command (a test suite, a build) calls `background_run` and exits immediately with its context clean, reporting the job ID back as its summary. The *main agent* sees the job ID in its context after the subagent returns, and can call `background_check` on its next turn to confirm completion. The slow work runs outside any agent's context window.

Research on multi-agent orchestration frameworks documents this coordination pattern. The [multi-agent orchestration paper (arxiv:2601.13671)](https://arxiv.org/html/2601.13671v1) identifies the key challenge as "coordination overhead and inefficiencies" in static organizational structures — exactly what a dynamic task DAG with explicit ownership resolves, by making the plan structure legible to all agents rather than implicit in the main agent's context. Anthropic's [context engineering guidance](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents) adds the complementary point: each agent in the system must know what information it has and when it was injected — shared durable state in the task DAG provides exactly this visibility.

## The notification routing problem

The most subtle design issue in this composition is notification routing. When a background job completes, its result is injected into the agent loop that drains the notification queue. In the architecture described in the [background tasks guide](/posts/s08-background-tasks/), `LoopConfig.subagent` sets `drainBackground: false` — subagent loops don't drain background notifications. This is correct: a subagent draining background results meant for the main agent would consume those results before the main agent ever sees them.

But with task-owned background jobs, there's a new variant: a subagent that starts a background job should leave the job running when it exits, and the main agent should drain the notification on its next turn. This works correctly with the existing `drainBackground` flag — the subagent starts the job, returns its summary (which includes the job ID), and exits without draining. The main agent continues its loop, the background job completes asynchronously, and the next `drainBackgroundNotifications` call in the main loop injects the result.

The durability gap is that the job ID is only in the main agent's context — it's not persisted to the task system. If auto-compaction fires between the subagent's return and the background job's completion, the job ID may be summarized away. The fix is explicit: when a subagent starts a background job, the main agent should update the relevant task's description to include the job ID before context grows further. This is a one-line `task_update` call that closes the durability gap entirely.

## Cascading completion and dependency resolution

The task DAG's cascading unblock mechanism interacts with subagent-based execution in a useful way. When a subagent completes a task and calls `task_update` with `status: "completed"`, the `removeCompletedDependency` cascade fires automatically — all tasks that listed this one in their `blockedBy` array lose the reference and become ready. The main agent, on its next turn, calls `task_list` and sees the updated dependency graph without needing to track which tasks unblocked.

This is the multi-agent coordination property: the task DAG carries state about what can proceed next, and any agent with read access can observe it. The [SWE-bench benchmarks](https://www.swebench.com/verified.html) for coding agent evaluation consistently find that long-horizon tasks — precisely the ones that require multi-step planning with dependencies — are where agent performance degrades fastest. A persistent, agent-visible task DAG is the architectural response to that degradation pattern: it externalizes the plan from any single agent's context and makes progress legible across the entire system.

## Parallel execution with the planner pattern

Research on parallelizing multi-agent work ([arxiv:2507.08944](https://arxiv.org/pdf/2507.08944)) shows up to 2.2x speedup when agents execute independent task branches concurrently rather than sequentially. The task DAG's `blockedBy` edges make the parallelism explicit: tasks with disjoint `blockedBy` sets can be delegated to subagents simultaneously.

The main agent orchestrates this by scanning `task_list` for all ready tasks (empty `blockedBy`), delegating each to a subagent (or a background job for the slow parts), and then processing their completions in whatever order they finish. This is the planner pattern: the main agent holds the plan structure and manages delegation, while subagents handle execution in isolated contexts. The cascade mechanism ensures that completing one branch automatically reveals the next — the main agent doesn't need to manually track what becomes ready.

Together, subagent isolation, the task DAG, and background execution produce orchestration that is coherent across arbitrary time: a plan survives compaction; subagent work is tracked in durable storage; slow jobs run outside the context window; completion cascades automatically. None of the three mechanisms produces this property in isolation. Composed around the task DAG as the shared coordination surface, they become a complete orchestration layer. The reliability properties that keep this layer working turn-by-turn — guarded tool dispatch, drift detection, convergence signaling — are examined in [Reliability Patterns in the Agent Loop](/posts/synth-loop-reliability/).
