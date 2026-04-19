---
title: "Trust is the wrong question for AI coding agents"
author: "Ivan Magda"
pubDatetime: 2026-04-19T09:00:00Z
slug: "trust-is-the-wrong-question-for-ai-coding-agents"
featured: true
draft: true
tags:
  - ai-agents
  - claude-code
  - context-engineering
description: "AI coding agents don't need our trust — they need a verification loop, explicit invariants, and a work system designed around them."
---

The first time an AI coding agent works, it feels like cheating.

We describe a bug. It reads the codebase. It finds the right files. It writes the patch. It runs the tests. Something that used to take an afternoon is done before our coffee goes cold.

Then the second experience arrives.

The agent misses an edge case. It changes the wrong abstraction. It produces code that looks correct but fails in a real environment. We spend the next hour untangling what it did. The magic turns into irritation.

That emotional arc is where many engineers stop. They conclude that agents are toys. Useful for demos. Maybe useful for prototypes. Not serious enough for production engineering.

I think that conclusion is wrong.

The better conclusion is this: **the process was not designed for this type of worker.**

## The wrong question: can we trust the model?

Most conversations about AI coding agents start with the same question: can we trust them?

That framing is already a trap.

We do not trust junior engineers blindly. We do not trust senior engineers blindly. We do not even trust ourselves blindly. We have tests, code review, CI, staging, canaries, monitoring, rollback, incident response, and postmortems because software engineering has never been based on pure trust.

The same applies to agents.

The goal is not to make the model trustworthy enough that we can stop checking its work. The goal is to build a system where the model can be useful **without requiring trust**.

That means the unit of evaluation is not the model. The unit of evaluation is the loop around the model.

## The loop that matters

A serious agentic coding workflow looks less like chat and more like a control system:

```
task → plan → action → verification → correction → repeat
```

The agent receives a task. It reads the relevant context. It creates a plan. It changes the code. It runs tests. It checks outputs. It gets feedback. It fixes what failed. It repeats until the verification loop passes.

This is the important part: the agent is not done when it produces code. The agent is done when the system can verify that the intended behavior holds.

Without that verify step, agents produce what I think of as beautiful lies. The output is coherent. The diff looks plausible. The explanation sounds confident. But nothing forces the result to be true. That is where production incidents come from.

## Invariants are the new center of gravity

For a long time, the central artifact of software engineering was code. Requirements were often vague. Documentation drifted. Tests were incomplete. The code was the thing that mattered because the code was the thing that shipped.

AI coding agents change that balance.

When code becomes cheaper to generate, the scarce resource moves somewhere else. The valuable artifacts become:

```
intent
requirements
invariants
tests
contracts
constraints
review criteria
operational guarantees
```

The question shifts from "who writes the code?" to "who defines what must be true?"

That is a much harder question. If the requirement is vague, the agent can only guess. If the invariant is not encoded, the agent can break it. If the test environment is missing, the agent cannot know whether it succeeded. If the production behavior is not observable, nobody knows what failed until users report it.

The most useful question in agentic development is: **what must never break?**

For a payments system, that might be: never charge a customer twice. For a mobile app: never block the UI thread. For a messaging system: never deliver a private message to the wrong recipient.

These are not implementation details. These are invariants.

Once an invariant is explicit, we can start building machinery around it. A test. A contract. A property check. A replay. A monitor. A QA checklist. A static analysis rule. A runtime assertion. A sandbox scenario. The agent can then operate inside a world where the important things are guarded.

This is the difference between vibe coding and engineering. Vibe coding asks the model to produce something that looks right. Engineering defines the conditions under which the output is allowed to exist.

## The engineer's role changes

This is the part that feels uncomfortable. If the agent writes more of the code, what does the engineer do?

The answer is not "become a prompt operator". That is too small.

The engineer becomes the designer of the work system. That includes deciding:

```
what context the agent receives
what tools it can use
what environment it runs in
what tests it must execute
what files it may touch
what changes require human review
what failures trigger escalation
what artifacts survive after the agent is done
```

This is not less engineering. It is a different layer of engineering. The old skill was often about writing the implementation. The new skill is increasingly about designing the system that safely produces the implementation.

## Wrapping up

AI coding agents are not magic employees. They are unreliable workers inside systems we have barely started designing.

That is the opportunity. The teams that win will not be the teams that blindly trust agents. They will be the teams that build the best scaffolding around them: the best requirements, the best tests, the best invariants, the best review loops, the best operational feedback.

Code will get cheaper. Intent will get more valuable. And the engineer who can translate intent into a safe, repeatable, verifiable production process will become more important, not less.

Thanks for reading!
