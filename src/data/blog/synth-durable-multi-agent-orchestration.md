---
title: "Durable Multi-Agent Work: Subagents, Task DAGs, and Background Execution"
author: "Ivan Magda"
pubDatetime: 2026-06-03T11:00:00Z
slug: "durable-multi-agent-orchestration"
featured: false
draft: false
hideFromFeed: true
tags:
  - ai-agents
  - context-engineering
  - claude-code
description: "Subagent isolation, a file-persisted task DAG, and background execution compose into orchestration that stays coherent across time and context boundaries."
---

Delegation and durability are orthogonal problems, and most agent architectures solve them independently. Subagents handle delegation: a child agent takes a scoped task, runs it in isolated context, and returns a summary. Task systems handle durability: plans persist to disk and survive compaction and restarts. Background execution handles concurrency: slow commands run without blocking the main loop. Treat the three as one system and they compose into something none reaches alone: multi-agent work that stays coherent across time, context boundaries, and parallel execution paths.

## The three isolation problems

Each mechanism solves a distinct isolation problem, and each creates a coordination gap when used alone.

Subagents (covered in the [subagents guide](/posts/s04-subagents/)) isolate context: a child agent starts with a fresh messages array, does its work, and returns only a text summary. The parent's context stays clean. The child's work is ephemeral. Once the subagent completes, its entire working history is gone. If the parent later needs to resume, revise, or audit what the child did, nothing remains to inspect.

The task system persists plans: tasks are JSON files in `.tasks/`, with explicit `blockedBy`/`blocks` dependency edges. A plan written to disk survives context compaction, process restarts, and long sessions. Its planning model is synchronous. It tells the agent what to do and tracks whether the work got done, but it doesn't manage how the work proceeds or which agent owns which step.

Background execution parallelizes slow work: a command handed to `background_run` returns a job ID right away, and the loop keeps moving. In isolation, background jobs are fire-and-forget. No durable record ties a job to its task, and if the agent restarts while a job runs, the completion notification is lost.

## The composition: task ownership + subagent execution + background jobs

Use the task DAG as the coordination layer across all three mechanisms.

Each task in the DAG carries an `owner` field, which anticipates multi-agent assignment. When the main agent decomposes a large plan into tasks and decides to parallelize, it delegates task execution to subagents. The subagent gets a prompt with the task ID, reads the task's description via `task_get`, does the work, and updates the status via `task_update` when done. The task DAG becomes a shared coordination surface: the main agent owns the plan structure, and subagents own individual task execution.

Background execution slots into this. A subagent whose task needs a slow command, such as a test suite or a build, calls `background_run` and exits with a clean context, reporting the job ID back as its summary. The main agent sees the job ID after the subagent returns and calls `background_check` on its next turn to confirm completion. The slow work runs outside any agent's context window.

Research on multi-agent orchestration frameworks documents this coordination pattern. The [orchestration survey (arxiv:2601.13671)](https://arxiv.org/abs/2601.13671) argues that coordinating autonomous agents depends on explicit orchestration logic and observability mechanisms to keep a distributed system coherent and accountable, which is what a dynamic task DAG with explicit ownership provides. It makes the plan structure legible to every agent rather than implicit in the main agent's context. Anthropic's [context engineering guidance](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents) adds the complementary point: each agent must know what information it holds and when that information arrived, and shared durable state in the task DAG supplies that visibility.

## The notification routing problem

The trickiest design issue in this composition is notification routing. When a background job completes, the loop that drains the notification queue receives its result. In the architecture from the [background tasks guide](/posts/s08-background-tasks/), `LoopConfig.subagent` sets `drainBackground: false`, so subagent loops don't drain background notifications. That is the right call: a subagent draining background results meant for the main agent would consume them before the main agent ever sees them.

Task-owned background jobs add a variant: a subagent that starts a background job leaves it running when it exits, and the main agent drains the notification on its next turn. The existing `drainBackground` flag handles this. The subagent starts the job, returns its summary with the job ID, and exits without draining. The main agent continues its loop, the background job finishes asynchronously, and the next `drainBackgroundNotifications` call in the main loop injects the result.

The durability gap: the job ID lives only in the main agent's context, not in the task system. If auto-compaction fires between the subagent's return and the job's completion, the summary can drop the job ID. The fix is explicit. When a subagent starts a background job, the main agent updates the relevant task's description to include the job ID before context grows further. One `task_update` call closes the gap.

## Cascading completion and dependency resolution

The task DAG's cascading unblock mechanism pairs well with subagent execution. When a subagent completes a task and calls `task_update` with `status: "completed"`, the `removeCompletedDependency` cascade fires: every task that listed this one in its `blockedBy` array loses the reference and becomes ready. On its next turn, the main agent calls `task_list` and reads the updated dependency graph without tracking which tasks unblocked.

That is the multi-agent coordination property: the task DAG carries state about what can proceed next, and any agent with read access can read it. The [SWE-bench benchmarks](https://www.swebench.com/verified.html) for coding agent evaluation find that long-horizon tasks, the ones that need multi-step planning with dependencies, are where agent performance degrades fastest. A persistent, agent-visible task DAG answers that degradation: it pulls the plan out of any single agent's context and makes progress legible across the system.

## Parallel execution with the planner pattern

Research on parallelizing multi-agent work ([arxiv:2507.08944](https://arxiv.org/abs/2507.08944)) reports up to 2.2x speedup when agents run independent task branches concurrently rather than in sequence. The task DAG's `blockedBy` edges make the parallelism explicit: tasks with disjoint `blockedBy` sets can go to subagents at the same time.

The main agent orchestrates this by scanning `task_list` for every ready task (empty `blockedBy`), delegating each to a subagent or a background job for the slow parts, then handling completions in whatever order they finish. This is the planner pattern: the main agent holds the plan structure and manages delegation while subagents run execution in isolated contexts. The cascade reveals the next branch as soon as one completes, so the main agent never tracks readiness by hand.

Together, subagent isolation, the task DAG, and background execution produce orchestration that holds across long spans of time: a plan survives compaction, subagent work lands in durable storage, slow jobs run outside the context window, and completion cascades through the graph. No single mechanism produces this property alone. Composed around the task DAG as the shared coordination surface, they form a complete orchestration layer. The reliability properties that keep this layer working turn by turn, namely guarded tool dispatch, drift detection, and convergence signaling, are examined in [Reliability Patterns in the Agent Loop](/posts/loop-reliability/).
