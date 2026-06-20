---
title: "An Agent Framework Hiding Inside a Session: Dynamic Profiles in Foundation Models"
author: "Ivan Magda"
pubDatetime: 2026-06-12T14:25:23Z
slug: "foundation-models-dynamic-profiles"
featured: false
draft: false
tags:
  - wwdc
  - foundation-models
  - swift
  - ai-agents
description: "Dynamic Profiles turn one LanguageModelSession into a declarative agent runtime: per-phase models, history transforms, and two orchestration patterns."
---

Let's say that we're building a hiking companion app with three distinct modes. In _scouting_ mode, the user describes the kind of trip they want and the model suggests destinations — a creative task that benefits from a big server model. In _planning_ mode, the model turns the chosen destination into a day-by-day itinerary — a complex task that benefits from reasoning. And in _trail_ mode, the user asks quick questions while walking — short factual exchanges that should work offline, with no server round-trip at all.

Each mode wants different instructions, different tools, and ideally a different model. But they're one conversation. The itinerary should know what was scouted, and the trail answers should know what was planned. Until this year, the Foundation Models framework gave us exactly one way to get this: tear down the [`LanguageModelSession`](https://developer.apple.com/documentation/foundationmodels/languagemodelsession) on every mode switch, carry the transcript across by hand, and write all the orchestration code ourselves.

At WWDC26, Apple shipped a different answer. **Dynamic Profiles** let a single session swap its instructions, tools, model, and generation options declaratively - a SwiftUI-style `body` that resolves to whichever configuration the current app state calls for, while the conversation history stays put. In this post, let's dig into how the new API works, walk through the two orchestration patterns Apple named on stage, and map all of it onto the agent mechanisms we've been building by hand in the [Swift coding-agent series](/posts/s01-the-agent-loop/).

_This is the third post in a series on the WWDC26 Foundation Models updates. The [overview](/posts/wwdc26-foundation-models-year-two/) covers the full picture, and the [Private Cloud Compute deep dive](/posts/foundation-models-private-cloud-compute/) covers the server model that several examples below route to._

## The boilerplate we used to write

Last year's session API was deliberately append-only. Instructions were fixed at init, the transcript only grew, and a session was bound to one model for its whole life. To switch personas mid-conversation, we had to rebuild the session ourselves watching app state with `withObservationTracking`, dropping the old instructions so they wouldn't stack up, and threading the transcript through to the replacement:

```swift
@Observable final class TripState { var mode = Mode.scouting }

func rebuildSession() {
    let history = session?.transcript.dropFirstInstructions() ?? Transcript()
    switch tripState.mode {
    case .scouting:
        session = LanguageModelSession(
            tools: [SaveDestinationTool(), SwitchModeTool(state: tripState)],
            instructions: "Suggest hiking destinations based on the user's wishes...",
            transcript: history
        )
    case .planning:
        session = LanguageModelSession(
            tools: [SaveItineraryTool()],
            instructions: "Turn the chosen destination into a day-by-day itinerary...",
            transcript: history
        )
    }
}

withObservationTracking { tripState.mode } onChange: { rebuildSession() }
```

This works, but every piece of it is our responsibility: the observation plumbing, the transcript surgery, the rebuild firing at the right moment. And if we want the _model_ to decide when to switch modes say, the user asks for an itinerary while still in scouting mode we need a tool that mutates `tripState.mode` and a session rebuild racing to happen before the next prompt. Three modes in, the orchestration code outweighs the feature.

## A session that changes hats

Dynamic Profiles replace that machinery with a declaration. We describe every configuration the session could have, and the framework handles the transitions. The simplest possible version is a struct conforming to [`LanguageModelSession.DynamicProfile`](https://developer.apple.com/documentation/foundationmodels/languagemodelsession/dynamicprofile), with a `body` that produces a single [`Profile`](https://developer.apple.com/documentation/foundationmodels/languagemodelsession/profile) a bundle of instructions and tools:

```swift
struct TrailGuideProfile: LanguageModelSession.DynamicProfile {
    var body: some DynamicProfile {
        Profile {
            Instructions {
                "You are a hiking companion. Answer trail questions briefly."
            }
            TrailConditionsTool()
        }
    }
}

let session = LanguageModelSession(profile: TrailGuideProfile())
```

If the shape looks familiar, that's the point it's the SwiftUI pattern applied to model configuration. The key mental model: a dynamic profile resolves to **exactly one active profile at a time**, and the `body` is re-evaluated **every time the session is prompted**. That second property is what makes the whole thing dynamic. Branch on app state inside `body`, and the session picks up the right configuration on the next request — no observation tracking, no rebuilds:

```swift
struct TripProfile: LanguageModelSession.DynamicProfile {
    var state: TripState

    var body: some DynamicProfile {
        switch state.mode {
        case .scouting:
            Profile { DestinationScout(state: state) }
                .model(state.pccModel)
                .temperature(1)
        case .planning:
            Profile { ItineraryAuthor(state: state) }
                .model(state.pccModel)
                .reasoningLevel(.deep)
        case .trail:
            Profile { TrailGuide() }
                .model(state.onDeviceModel)
        }
    }
}
```

Note how each branch picks its own model and generation options through modifiers. Scouting runs on [Private Cloud Compute](/posts/foundation-models-private-cloud-compute/) with the temperature cranked up for creative suggestions. Planning stays on the server model but trades latency for `.deep` reasoning, since itineraries have real constraints to satisfy. Trail mode drops to the on-device model: free, offline, and plenty for short factual answers. We're switching models mid-session with one modifier per branch; the conversation history carries across every switch, and what changes is the instructions entry at the top of the transcript and the configuration around it.

The `switch` isn't a style choice: [`DynamicProfileBuilder`](https://developer.apple.com/documentation/foundationmodels/languagemodelsession/dynamicprofilebuilder) only accepts control-flow expressions `switch`, or `if`/`else` chains, so the compiler can verify that only one profile is active per evaluation. Parallel `if` statements won't compile.

One contract the docs leave open is concurrency. The body re-evaluates mid-request while reading shared app state, and beta 1's documentation doesn't say what isolation it expects of that state — re-check at GM before leaning on `@Observable` classes inside `body`.

## Composing instructions like views

A `Profile` wraps instructions and tools, but stuffing every instruction string into the profile gets unwieldy for the same reason monolithic SwiftUI views do. The composable unit is [`DynamicInstructions`](https://developer.apple.com/documentation/foundationmodels/dynamicinstructions) a group of related instructions and tools that can be nested, where nesting concatenates:

```swift
struct DestinationScout: DynamicInstructions {
    var state: TripState

    var body: some DynamicInstructions {
        Instructions {
            "You are an enthusiastic trip scout. Suggest hiking destinations \
             that match the user's fitness level and time budget."
        }
        SaveDestinationTool()
        if state.wishlist.includesAlpineRoutes {
            AlpineSafetyExpert()
        }
    }
}
```

`AlpineSafetyExpert` here is its own `DynamicInstructions` a chunk of domain knowledge about altitude, weather windows, and gear, plus a route-grading tool. It only joins the prompt when the user is actually considering alpine routes, which keeps the context lean the rest of the time. Since the body re-evaluates on every prompt, that conditional stays current as the wishlist changes.

When modifiers conflict, the precedence is what we'd hope: options passed at the call site to [`respond(to:options:)`](<https://developer.apple.com/documentation/foundationmodels/languagemodelsession/respond(to:options:)>) win, then the innermost profile modifier, and dynamic-profile-level modifiers act as inherited defaults. Lifecycle hooks which we'll meet in a moment are the exception: they accumulate across nested profiles rather than overriding each other.

## Trimming history without losing it

There's a problem hiding in our `TripProfile`, though. Scouting and planning run on Private Cloud Compute with its 32K-token context window. Trail mode runs on-device, where the window is a fraction of that. After a long planning conversation, switching to trail mode would hand the small model a transcript it can't fit. Most of that transcript is brainstorming chatter anyway. The trail guide needs the itinerary, which lives in the tool calls and outputs that `SaveItineraryTool` produced along the way.

That's where [`historyTransform`](<https://developer.apple.com/documentation/foundationmodels/languagemodelsession/dynamicprofile/historytransform(_:)>) comes in. A transform receives the history, everything in the transcript after the instructions entry, just before a request goes out, and returns the entries to send. Here's one for trail mode that keeps the tool records plus the latest exchange, and drops the prose in between:

```swift
case .trail:
    Profile { TrailGuide() }
        .model(state.onDeviceModel)
        .historyTransform { history in
            guard let latestResponse = lastResponseIndex(in: history) else {
                return Array(history)
            }
            let records = history[..<latestResponse].filter(isToolCallOrOutput)
            return Array(records) + Array(history[latestResponse...])
        }
```

The crucial property: transforms are **local and non-mutating**. The session's real transcript stays intact; the trimmed view exists only for that request. Switch back to planning, and the server model sees the full history again. Context size isn't the only reason to reach for a transform, Apple also calls out trimming for _focus_, which is what the filter above does, and for _privacy_ (redact entries before routing to a less private model). And when the budget is tokens rather than entries, [`SystemLanguageModel.tokenCount(for:)`](<https://developer.apple.com/documentation/foundationmodels/systemlanguagemodel/tokencount(for:)>) can measure what a transform keeps.

However, that closure is a lot to carry inline, and every profile we back with the small model will want the same trim. We can borrow the move SwiftUI uses for reusable styling: extract the transform into a [`DynamicProfileModifier`](https://developer.apple.com/documentation/foundationmodels/languagemodelsession/dynamicprofilemodifier), then expose it through an extension so it reads like a built-in:

```swift
struct KeepingTripRecordsModifier: LanguageModelSession.DynamicProfileModifier {
    func body(content: Content) -> some DynamicProfile {
        content.historyTransform { history in
            ...
        }
    }
}

extension LanguageModelSession.DynamicProfile {
    func keepingTripRecords() -> some DynamicProfile {
        modifier(KeepingTripRecordsModifier())
    }
}
```

With that in place, the `.trail` branch collapses to `Profile { TrailGuide() }.model(state.onDeviceModel).keepingTripRecords()`.

Apple ships prebuilt history modifiers of the same shape in the open-source [Foundation Models framework utilities](https://github.com/apple/foundation-models-utilities) package, updated between OS releases. Scouting is the natural customer: once a destination is saved through its tool, the tool-call entries are disposable, and a long brainstorm only needs its recent turns:

```swift
import FoundationModelsUtilities

case .scouting:
    Profile { DestinationScout(state: state) }
        .model(state.pccModel)
        .temperature(1)
        .rollingWindow(size: .entries(10))
        .droppingCompletedToolCalls()
```

A rolling window keeps the most recent ten entries, and `droppingCompletedToolCalls()` clears finished tool rounds out of what remains. Note how scouting drops the very entries trail mode kept, the trail guide needs those tool records in its prompt, while scouting's are safe in app state the moment the tool runs. That contrast is why transforms are scoped per profile rather than per session.

## When trimming isn't enough: lifecycle hooks and session properties

Transforms are stateless by design. For stateful context management, the classic example is summarizing old history to reclaim the window, the API gives us [lifecycle hooks](https://developer.apple.com/documentation/foundationmodels/languagemodelsession/dynamicprofile): `onActivate`, `onPrompt`, `onToolCall`, `onToolOutput`, `onDeactivate`, and `onResponse`, each running imperative code at a session boundary. Alongside them, **session properties** hold state that every profile, instruction block, and tool in the session can see. `history` is a built-in one; we can declare our own with an initial value:

```swift
extension SessionPropertyValues {
    @SessionPropertyEntry var summary: String? = nil
}
```

Putting both together gives us summarize-and-drop, which compresses old exchanges into a summary on a response boundary, then feed that summary back in through the instructions so the dropped context isn't gone:

```swift
@SessionProperty(\.history) var history
@SessionProperty(\.summary) var summary

var body: some DynamicProfile {
    Profile {
        ItineraryAuthor(state: state)
        if let summary {
            Instructions { "Summary of the conversation so far: \(summary)" }
        }
    }
    .onResponse {
        if history.count > 100, let cut = lastResponseIndex(in: history.prefix(50)) {
            summary = try await summarize(history[..<cut])
            history = history[cut...]
        }
    }
}
```

One thing to keep in mind here is the division of labor between this and `historyTransform`: writes to the `history` property are **lossy and global** — they change the real transcript for every profile in the session, while transforms are lossless and scoped to one profile. Apple's guidance is to prefer transforms unless we want the history gone for good. (The `history` property is also read-only inside `DynamicInstructions` and [`Tool`](https://developer.apple.com/documentation/foundationmodels/tool) bodies; Apple's own examples mutate it from lifecycle hooks like `onResponse`.) And if summarize-and-drop is exactly the pattern needed, the utilities package ships it prebuilt as a `summarizeHistory` modifier.

## Baton-pass and phone-a-friend

So far our profiles switch when _app state_ changes. The more interesting case is the model switching modes _itself_ and this is where the agent framework from the title shows up. Apple names two orchestration patterns, and the distinction comes down to who sees the transcript and who gives the final answer.

**Baton-pass** is a collaboration. Two or more profiles share the session's transcript, a state variable controls which is active, and each profile carries a tool that flips that variable. The mechanic that makes it work is one we've already met: the `body` re-evaluates not just per prompt but after every tool round-trip _within_ a single `respond` call. So when the active profile passes the baton, the next profile takes over mid-response:

```
user: "Turn this into a five-day itinerary"
  │
  ▼
┌── scouting profile (PCC, creative) ─────────────────┐
│  sees the full transcript                           │
│  decides this is planning work                      │
│  calls PassBatonTool ─── sets state.mode = .planning│
└─────────────────────────────────────────────────────┘
  │
  │  body re-evaluates: planning profile is now active
  ▼
┌── planning profile (PCC, deep reasoning) ───────────┐
│  same transcript, new instructions and tools        │
│  writes the final answer                            │
└─────────────────────────────────────────────────────┘
  │
  ▼
response streams back to the user
```

In code, the pattern is compact. `PassBatonTool` is ours to declare — a trivial `Tool` whose description tells the model when to hand off and the `onToolCall` hook does the flipping, guarded on the tool name so the profiles' other tools don't trigger a handoff:

```swift
case .scouting:
    Profile { DestinationScout(state: state); PassBatonTool() }
        .onToolCall { toolCall in
            if toolCall.toolName == "pass_baton" { state.mode = .planning }
        }
        .model(state.pccModel)
case .planning:
    Profile { ItineraryAuthor(state: state); PassBatonTool() }
        .onToolCall { toolCall in
            if toolCall.toolName == "pass_baton" { state.mode = .scouting }
        }
        .model(state.pccModel)
```

Without the guard, any tool call in the profile would pass the baton `SaveDestinationTool` included. Hooks double as validation checkpoints too: throwing from `onToolCall` propagates out of `respond`, vetoing a call before it runs.

**Phone-a-friend** is a consultation. Instead of handing over the session, a tool spawns a short-lived child session with its own profile and an _isolated_ transcript, prompts it, and returns the child's response as tool output. The child never sees the parent's history, and the parent always writes the final answer:

```
user: "Save this trip with a good name"
  │
  ▼
┌── parent session (full transcript) ─────────────────┐
│  model calls GenerateTripNameTool                   │
│    │                                                │
│    ▼                                                │
│  ┌── child session (fresh, isolated) ────────────┐  │
│  │  its own profile, instructions, and model     │  │
│  │  responds once, then is discarded             │  │
│  └───────────────────┬───────────────────────────┘  │
│                      ▼                              │
│  child's answer comes back as the tool output       │
│  parent writes the final answer                     │
└─────────────────────────────────────────────────────┘
```

The whole pattern fits inside an ordinary `Tool`:

```swift
struct PhoneFriendTool<P: LanguageModelSession.DynamicProfile>: Tool {
    ...
    func call(arguments: GeneratedContent) async throws -> String {
        let session = LanguageModelSession(profile: profile())
        let response = try await session.respond(to: arguments)
        return response.content
    }
}
```

Choosing between them is a question about context. Baton-pass when the receiving specialist needs the full conversation to do its job — our scouting-to-planning handoff, where the itinerary depends on everything discussed. Phone-a-friend when the subtask is self-contained and the parent's history would be noise — naming a trip, scoring a single option, summarizing a block of old history for the compaction hook above.

## Required tool calling is a while-loop

Profiles also gained control over _whether_ tools run. The new [tool-calling modes](https://developer.apple.com/documentation/foundationmodels/generationoptions/toolcallingmode-swift.struct) are `.allowed` (the default, the model decides), `.disallowed` (no tool calls, for parts of the app where the session's tools make no sense), and `.required` (the model can _only_ call tools, never answer directly). Required mode is the agentic one: every action flows through a tool, which is what we want when the model is operating an app rather than chatting.

However, there's a trap in that last mode. A model that can only call tools has no way to finish. Required mode puts the session in a while-loop, and we owe it an exit condition. One option is conditionalizing the mode on state that a hook flips. The other, which Apple shows is a final-answer tool that breaks the loop by throwing:

```swift
actor FinalAnswerTool: Tool {
    let name = "give_final_answer"
    let description = "Provide a final answer after all work is complete"
    var output: String?

    @Generable struct Arguments { var answer: String }

    func call(arguments: Arguments) async throws -> Never {
        output = arguments.answer
        throw CancellationError()
    }
}
```

At the call site, we catch the `CancellationError` and read the answer off the tool, the throw is the loop's exit, not a failure. If you've read [the agent loop post](/posts/s01-the-agent-loop/), this should feel like meeting an old friend in unexpected clothes. Our hand-rolled loop's exit was a single `stopReason` check, loop while the model calls tools, return when it answers. Required mode removes the "model answers" branch, so the exit condition has to come back as a tool.

One cost to watch when the loop runs on Private Cloud Compute: every pass through it is a server request, and requests spend from the user's daily allowance (the [PCC post](/posts/foundation-models-private-cloud-compute/) covers the quota machinery). Apple hasn't said whether the framework caps tool round-trips per `respond`, so a defensive iteration counter in an `onToolCall` hook is cheap insurance against a loop burning a budget that only resets tomorrow.

A throwing tool has a side effect, though: under the [`.revertTranscript`](https://developer.apple.com/documentation/foundationmodels/transcripterrorhandlingpolicy/reverttranscript) policy, an error rolls the transcript back to its state before the `respond` call, the partial work vanishes. That's now configurable through [`transcriptErrorHandlingPolicy`](<https://developer.apple.com/documentation/foundationmodels/languagemodelsession/dynamicprofile/transcripterrorhandlingpolicy(_:)>), settable on a profile or a session: [`.preserveTranscript`](https://developer.apple.com/documentation/foundationmodels/transcripterrorhandlingpolicy/preservetranscript) keeps everything in place, including a possibly half-generated last entry, and hands us the job of getting the session back into a coherent state before the next request. For a final-answer tool whose throw is the intended exit rather than a failure, that's often exactly what we want.

## The bill for rewriting history

Mutable transcripts, history rewrites, instruction swaps — last year none of this was possible, and Apple is candid that the restriction was deliberate. The append-only design protected two things, and both are now our problem.

The first is performance. Like every transformer runtime, the framework leans on KV caches, and appending to a transcript preserves the cache while rewriting it removing entries, changing the attached tools, updating instructions typically invalidates it. The visible symptom is time-to-first-token jumping after a profile switch. Different models cache differently, so the honest answer to "how much does this cost?" is to measure: the Foundation Models instrument in Xcode 27's Instruments breaks the tool-call loop down per request and shows cache behavior alongside latency.

The second is accuracy. A small example makes the failure concrete. Suppose a session has spent a while generating project titles in plain responses. Partway through, we add a title-generating tool and ask for more titles, expecting the model to call it. It doesn't: the transcript already shows titles appearing _without_ any tool, so the model follows that established pattern rather than our new instructions. The model reads the transcript as few-shot evidence about how the conversation behaves, so editing it can teach a pattern we never intended. Apple's recommended defense is the new Evaluations framework: build an eval set for the feature and judge each context-engineering trick by its scores.

That's also the lens for the four words Apple puts on its decision slide: privacy, cost, capability, KV cache. Every profile switch is a trade across those four; the framework removes the boilerplate and leaves the cost for us to measure.

## Mapping it onto a hand-rolled agent

If you've followed the [coding-agent series](/posts/s01-the-agent-loop/) on this blog, most of this post probably triggered déjà vu. That's the part I find most interesting: Apple sat down to design agent primitives for a Swift session API and landed on the same shapes we built by hand over nine posts:

| Foundation Models primitive                 | What we hand-rolled in the series                             |
| ------------------------------------------- | ------------------------------------------------------------- |
| `.required` tool mode + a final-answer tool | The agent loop ([Part 1](/posts/s01-the-agent-loop/))         |
| Phone-a-friend child sessions               | Subagents ([Part 4](/posts/s04-subagents/))                   |
| `Skills` in the utilities package           | Skill loading ([Part 5](/posts/s05-skill-loading/))           |
| Summarize-and-drop in `onResponse`          | Context compaction ([Part 6](/posts/s06-context-compaction/)) |

Anyone who builds agents long enough runs into the same problems: exit conditions, context isolation, knowledge injection, compaction, observability and the solution space is small.

So: if there's an agent framework hiding inside `LanguageModelSession`, do we still need real ones? For a lot of in-app features: mode-switching assistants, model routing, tool-driven workflows that live and die with a session — I think Dynamic Profiles cover it, with no dependency and first-party support. What they deliberately don't cover is anything that outlives the session: durable task queues, parallel background agents, long-horizon work that survives an app restart. Those were [Part 7](/posts/s07-task-system/) and [Part 8](/posts/s08-background-tasks/) of the series for a reason — persistence and parallelism need infrastructure that outlives any single session.

## Where this leaves us

Dynamic Profiles take the most tedious part of building multi-mode LLM features, the session juggling and the hand-carried transcripts, and compress it into a declarative `body` with one rule: exactly one profile active at a time, re-evaluated on every prompt. Rewriting history costs cache performance and can cost accuracy, and Apple hands us Instruments and Evaluations.

The framework is in its first beta, the utilities package will keep moving between OS releases, and some of these names may change before September. Apple's downloadable sample, [Origami: Crafting a dynamic tutorial for Apple Intelligence](https://developer.apple.com/documentation/foundationmodels/origami-crafting-a-dynamic-tutorial-for-apple-intelligence), shows the whole toolkit working together in one app, and it's the best place to poke at these APIs today. Thanks for reading!
