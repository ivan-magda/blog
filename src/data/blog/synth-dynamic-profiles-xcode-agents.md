---
title: "The Agent Abstraction, Top to Bottom: Dynamic Profiles in Your App, Plugins in Xcode"
author: "Ivan Magda"
pubDatetime: 2026-06-09T09:30:00Z
slug: "dynamic-profiles-xcode-agents"
featured: false
draft: false
hideFromFeed: true
tags:
  - apple-intelligence
  - foundation-models
  - xcode
  - ai-agents
  - wwdc
description: "WWDC 2026 shipped the same agent vocabulary (skills, sub-agents, swappable tools, open protocols) on both sides of the IDE: Dynamic Profiles inside our app and plugins inside Xcode."
---

This week we're building two things at once. Inside our app, we're wiring up an on-device feature with the Foundation Models framework. In Xcode, we're letting a coding agent help us build it. Two jobs, two sets of docs, two WWDC sessions — easy to treat as unrelated. They aren't, and once we see the idea in one place we've mostly seen it in the other.

## The shape, in one sentence

An agent is a small set of swappable parts — some instructions, a few tools, a model — composed over one shared context. That's the whole shape. Whether the agent lives inside our app or inside our editor, it holds, and WWDC 2026 gave it first-class APIs on both sides of the boundary at once: Dynamic Profiles in the app, plugins in Xcode. Let's look at each, then at why they're the same thing.

## Inside the app: Dynamic Profiles

A Dynamic Profile is a declarative unit we attach to a `LanguageModelSession`. Instead of pinning a session to one model, one tool set, and one instruction block, we write a body that resolves to a single profile per turn and switch profiles as the app's state changes ([Composing dynamic sessions with instructions and profiles](https://developer.apple.com/documentation/foundationmodels/composing-dynamic-sessions-with-instructions-and-profiles)):

```swift
// The body resolves to exactly one profile per model turn.
var body: some DynamicProfile {
    switch state {
    case .brainstorming:
        Profile { ... }.model(cloudModel).temperature(0.9)
    case .reasoningHard:
        Profile { ... }.reasoningLevel(.deep)
    case .quickLookup:
        Profile { ... }   // on-device, to save server calls
    }
}
```

Every profile shares one continuous transcript, so swapping the model mid-session keeps the context intact. Apple's own framing gave the game away: three profiles "look a bit like three AI agents," and that's the intent — profiles are the unit we build agents and skills out of ([Build agentic app experiences with the Foundation Models framework, WWDC26](https://developer.apple.com/videos/play/wwdc2026/242)).

## Inside Xcode: plugins, skills, and ACP

Now the editor. Xcode 27's agents run on a corpus of specialists — SwiftUI, accessibility, sizing, testing, performance — and each specialist ships as a plugin. A plugin carries skills (markdown files that teach a task), tools exposed through the [Model Context Protocol](https://developer.apple.com/documentation/xcode/giving-external-agents-access-to-xcode), and, new this year, an agent of our choice through the Agent Client Protocol ([Xcode, agents, and you, WWDC26](https://developer.apple.com/videos/play/wwdc2026/259)).

Set the two lists next to each other and they rhyme term for term. A skill is a markdown capability in Xcode and a swappable instruction block in a profile. A tool is an MCP function in the editor and a `Tool` value in a session. A sub-agent is an ACP-brought agent in Xcode and a profile we switch to in the app. Both build from small replaceable parts over a shared context, never one monolithic prompt.

## We've wired these joints by hand before

None of this reads as coincidence if we've built the primitives ourselves. The [Building a Coding Agent in Swift](/posts/s04-subagents/) series spent whole posts on exactly these units — subagents as context-isolated loops with restricted tools, and [skill loading](/posts/s05-skill-loading/) as markdown knowledge surfaced on demand. Doing it by hand is what makes "skill," "tool," and "sub-agent" stop looking like three features and start looking like joints of one design. Apple has now cast those joints as APIs. And the choice each profile makes — a cheap local model or a capable remote one — is the per-feature decision that [Three Ways to Run a Model on Apple Platforms](/posts/apple-platform-ai-model-strategy/) is entirely about, except a profile makes it turn by turn.

## One shape, learned once

"Agent" isn't a thing Apple shipped this year. It's a shape — swappable instructions, tools, and models over shared context — that finally has APIs on both sides of the IDE. The real win is that the judgment transfers: what we build deciding which tools a sub-agent should see, or when to compact a transcript, is what we spend on a profile's body and on which specialists we hand an Xcode agent. Learn it once, apply it twice. Thanks for reading!
