---
title: "Any Model, One Session: How Apple's LanguageModel Protocol Turned Foundation Models Into a Universal LLM Client"
author: "Ivan Magda"
pubDatetime: 2026-06-15T09:00:00Z
slug: "foundation-models-custom-llm-provider"
featured: false
draft: true
tags:
  - wwdc
  - foundation-models
  - swift
  - ai-agents
description: "Apple's new LanguageModel protocol lets a LanguageModelSession be backed by any model: a server, an open model, Claude, or Gemini, with everything downstream unchanged."
---

The most important AI announcement at WWDC26 was an interface, not a model.

Last year, the Foundation Models framework gave us a thin Swift wrapper over one small on-device model: useful, private, and narrow. This year, with a single pair of protocols, a `LanguageModelSession` can be backed by any large language model. Apple's on-device model, its server model on Private Cloud Compute, a self-hosted open-weights model, Claude, Gemini, or a model we wrote ourselves last weekend. Apple put the claim right in the documentation: ["Adopt the Language Model protocol to use any large language model, server or on-device, with the Foundation Models framework."](https://developer.apple.com/documentation/updates/foundationmodels)

That one sentence reads like an API note, but it marks a strategic pivot. Apple is no longer betting that its model wins. It's betting on its _client_ and inviting every other model into the building.

_This post is part of a series on the WWDC26 Foundation Models updates; the [overview](/posts/wwdc26-foundation-models-year-two/) covers the full picture. We'll focus here on the provider's half of the story: how a model gets behind that session in the first place._

_Everything below comes from the first iOS 27 / macOS 27 developer betas. Most of these APIs are marked Beta in Apple's documentation, and the third-party packages are earlier still. Details may shift before the fall release. The anchor session is [Bring an LLM provider to the Foundation Models framework](https://developer.apple.com/videos/play/wwdc2026/339/)._

## What the swap buys an existing app

Consider an app that already ships. If a feature calls `session.respond(to:)`, decodes `@Generable` structured output, dispatches tools, or streams tokens, every one of those behaviors keeps working when the model behind the session changes, because they talk to a protocol, not to a model. Swapping providers becomes a SwiftPM dependency line and one init argument instead of a feature rewrite.

The whole proposition fits in eight lines, and the only thing that changes between them is which type we hand the session:

```swift
import FoundationModels

// On-device, server, or third-party: the call site is identical.
let model = SystemLanguageModel()
// let model = PrivateCloudComputeLanguageModel()
// let model = ClaudeLanguageModel(name: .sonnet4_6, auth: .apiKey(anthropicKey))

let session = LanguageModelSession(model: model)
let response = try await session.respond(to: "Plan a weekend trip to Mackinac Island.")
print(response.content)
```

Hold that snippet next to the world it replaces. Today, wiring a frontier model into an app means hand-rolling an adapter per provider, each one reinventing streaming, tool dispatch, retry, and the JSON-coaxing that passes for structured output. Every app ends up with its own slightly different, slightly buggy version of the same plumbing. Apple's move is to make that plumbing a system API and let the model be the part we choose. [`SystemLanguageModel`](https://developer.apple.com/documentation/foundationmodels/systemlanguagemodel) is the on-device baseline, and [`PrivateCloudComputeLanguageModel`](https://developer.apple.com/documentation/foundationmodels/privatecloudcomputelanguagemodel) is Apple's own keyless, entitlement-gated server model. Neither one is privileged; they're the first two conformers.

## Decision one: should we implement this at all?

Conforming to the protocol is real work, and before any of the mechanics matter, there's a more basic question: are we even the audience for it? Three options compete, and they serve different goals.

| Approach | What it buys | What it costs | Reach for it when |
| --- | --- | --- | --- |
| Implement `LanguageModel` | Drop-in for any FM app; `@Generable`, tools, streaming, Dynamic Profiles for free | Two protocols, transcript translation, the streaming handshake | We're a model provider and want FM apps to swap us in with one line |
| Ship a standalone SDK | Total control over surface and release cadence | Every app re-learns our API; no FM features | Our API is unusual enough that the FM shape would fight it |
| Use `PrivateCloudComputeLanguageModel` | Zero protocol work; Apple's server model | Apple's model only; entitlement-gated | We want a good server model and don't need our own |

The deciding factor is which role we play. An app developer who wants a server LLM should reach for [Private Cloud Compute](/posts/foundation-models-private-cloud-compute/), the zero-key-management server branch, or import a package someone else already wrote. The protocol is for the _provider_: the team with a model (a hosted endpoint, a self-hosted open-weights model, a frontier API) that wants Swift apps to treat it as a peer of Apple's own. The rest of this post takes the provider's side of that contract.

## The whole trick is two protocols

The call site stays tiny because Apple split the work in half. [`LanguageModel`](https://developer.apple.com/documentation/foundationmodels/languagemodel) is the light, declarative half that describes the model. [`LanguageModelExecutor`](https://developer.apple.com/documentation/foundationmodels/languagemodelexecutor) is the working half that does the generation. The model is trivial to construct, and all the weight lives in the executor.

```swift
public protocol LanguageModel: Sendable {
    associatedtype Executor: LanguageModelExecutor
    var capabilities: LanguageModelCapabilities { get }
    var executorConfiguration: Executor.Configuration { get }
}

public protocol LanguageModelExecutor: Sendable {
    associatedtype Configuration: Hashable, Sendable
    associatedtype Model: LanguageModel

    init(configuration: Configuration) throws
    func prewarm(model: Model, transcript: Transcript) // default: no-op
    func respond(
        to request: LanguageModelExecutorGenerationRequest,
        model: Model,
        streamingInto channel: LanguageModelExecutorGenerationChannel
    ) async throws
}
```

The split encodes a design opinion. A model declares its _capabilities_ and hands over a `Configuration`, and that's all it does. Everything expensive (opening a connection, loading weights, translating formats, streaming tokens) lives behind the executor, where the framework can manage its lifetime. That separation is why the app-facing API never grew: the only surface a developer touches is `LanguageModelSession`, and the model becomes a value that names a config. A model pairs with exactly one executor type, and the framework instantiates the executor from the configuration the model provides. ([`prewarm`](https://developer.apple.com/documentation/foundationmodels/languagemodelexecutor/prewarm(model:transcript:)) has a no-op default, so a server-backed model can skip it entirely.)

## Configuration as cache key

The sharpest idea in the design hides in one conformance. The executor's [`Configuration`](https://developer.apple.com/documentation/foundationmodels/languagemodelexecutor/configuration) is constrained to be `Hashable` and `Sendable`, and the framework uses it as the key into a per-session executor store. When a model arrives, the framework hashes its `executorConfiguration` and looks it up: a match reuses the existing executor, a miss constructs a fresh one and stores it.

![Diagram: a session's executor store keyed by Configuration; two models with an equal configuration resolve to the same executor, while a different configuration gets its own.](/diagrams/fm-executor-store.svg)

_The executor store, keyed by the Configuration. Equal configurations share an executor; a different one gets its own._

In the skeleton below, the model stays light and the configuration carries everything that identifies an executor:

```swift
public struct MyLanguageModel: LanguageModel {
    public var capabilities: LanguageModelCapabilities {
        LanguageModelCapabilities(capabilities: [.toolCalling, .guidedGeneration, .reasoning])
    }
    public var executorConfiguration: MyExecutor.Configuration {
        MyExecutor.Configuration(/* endpoint, modelID, ... */)
    }
}

public struct MyExecutor: LanguageModelExecutor {
    public typealias Model = MyLanguageModel
    // Hashable: identical configs reuse one executor, and its KV cache / connection.
    public struct Configuration: Hashable, Sendable { /* ... */ }
    public init(configuration: Configuration) throws { /* open the connection once */ }
}
```

That one `Hashable` conformance carries the whole cost model. Two models that produce the _same_ configuration resolve to the _same_ executor instance, so a KV cache or a persistent connection survives across calls for free. A model with a _different_ configuration gets its own executor. When the session deallocates, the store goes with it: the framework releases every executor, `deinit` runs, weights are freed, connections close, and we wrote none of that teardown. A value type's equality carries the entire lifecycle contract.

That's the kind of design that looks obvious only in hindsight. Most caching schemes make us invent a key, a cache, and an eviction policy. Apple folded all three into a conformance the compiler already checks for us. Get `Configuration` right and we inherit the cost model for free. Get it wrong, say by stuffing a request ID into the config, and we spawn a fresh executor on every call and defeat the whole thing. The same trap hides a subtler bug: leave a tenant ID out of the configuration and two tenants will silently share an executor, the kind of thing that passes a demo and surfaces in production.

[`LanguageModelCapabilities`](https://developer.apple.com/documentation/foundationmodels/languagemodelcapabilities) deserves a note alongside this. There are four documented capabilities: `.guidedGeneration`, `.reasoning`, `.toolCalling`, and `.vision` (image inputs in prompts). [`Capability`](https://developer.apple.com/documentation/foundationmodels/languagemodelcapabilities/capability) is a struct of static values rather than an enum, so we build the set with the `capabilities:` label and inspect it with `contains(_:)`.

One sharp edge to keep honest: there are two KV-cache stories here, and they're easy to conflate. This one is the executor's, deciding when a saved connection is still valid. The other belongs to the app developer, covered in [Apple's article on optimizing key-value caching](https://developer.apple.com/documentation/foundationmodels/optimizing-key-value-caching-in-language-model-sessions): keep a stable prompt prefix, append at the end, don't trim the middle. Both are real, and they live on opposite sides of the protocol.

## Transcript translation is the universal adapter, now a system API

Inside `respond`, the executor's real job is translation. The framework hands it a [`Transcript`](https://developer.apple.com/documentation/foundationmodels/transcript), the conversation so far, in six entry types: `instructions`, `prompt`, `response`, `toolCalls`, `toolOutput`, and `reasoning`. The executor maps those onto whatever roles its backend speaks (system, user, assistant, tool), generates, and maps the result back.

Anyone who has written an OpenAI or Anthropic chat-completions bridge has built this adapter by hand, usually more than once. Apple's contribution is turning that recurring pattern into a typed protocol surface, so we write it once per model instead of once per app. Each request also carries the developer's intent in two distinct channels, and the line between them governs how a backend gets configured:

```swift
func respond(
    to request: LanguageModelExecutorGenerationRequest,
    model: MyLanguageModel,
    streamingInto channel: LanguageModelExecutorGenerationChannel
) async throws {
    let reasoningLevel = request.contextOptions.reasoningLevel
    let temperature    = request.generationOptions.temperature
    let maxTokens      = request.generationOptions.maximumResponseTokens
    let mode           = request.generationOptions.samplingMode
    let tools          = request.enabledToolDefinitions
    // ...translate request.transcript into your backend's native format...
}
```

[`ContextOptions`](https://developer.apple.com/documentation/foundationmodels/contextoptions) shapes what goes _into_ the prompt: `reasoningLevel`, `includeSchemaInPrompt`. [`GenerationOptions`](https://developer.apple.com/documentation/foundationmodels/generationoptions) governs the decoder loop itself: `samplingMode`, `temperature`, `maximumResponseTokens`. One describes the request, the other describes how to generate against it. Two naming traps to carry from the WWDC slides into shipping code: the current sampling property is `samplingMode`, and `sampling` is now marked deprecated in the docs, so `request.generationOptions.samplingMode == .greedy` is the idiom to write today. And the property we read inside `respond` is `enabledToolDefinitions`; the `enabledTools:` label only shows up when building a request by hand.

## The streaming handshake bakes UX into the protocol

On the way out, the executor sends events into a [`LanguageModelExecutorGenerationChannel`](https://developer.apple.com/documentation/foundationmodels/languagemodelexecutorgenerationchannel), and the order Apple's own example follows is a small design opinion that other streaming APIs often get wrong: metadata first, usage second, then text deltas.

![Diagram: the streaming handshake in order, metadata first, then usage with prompt token counts before generating, then one text delta per token.](/diagrams/fm-streaming-handshake.svg)

_The handshake order: metadata, then usage before generating, then one text delta per token._

```swift
let entryID = UUID().uuidString

// 1. Identify the model/request for logging.
await channel.send(.response(entryID: entryID, action: .updateMetadata([
    "modelID": "my-model-2026-06-08",
    "requestID": request.id.uuidString
])))

// 2. Report prompt-token cost BEFORE generating, so the app isn't blind.
await channel.send(.response(entryID: entryID, action: .updateUsage(
    input:  .init(totalTokenCount: promptTokens, cachedTokenCount: cachedTokens),
    output: .init(totalTokenCount: 0, reasoningTokenCount: 0)
)))

// 3. Stream text as it arrives. Each `fragment` is a TextFragment, not a bare String.
for try await fragment in tokens {
    await channel.send(.response(entryID: entryID, action: .appendText(fragment)))
}
```

The interesting move is the second send. Reporting the prompt-token count up front means the app knows what a request costs before a single output token arrives, instead of learning the bill only after the stream finishes. For a metered third-party model, that's the difference between a UI that can warn "this is a big one" and one that surprises the user after the fact. It's a borrowable idea other streaming APIs miss: the cost of a request is knowable before the answer, so we shouldn't make callers wait for the answer to learn it. The one-shot API is this same path with the deltas collected internally, so it streams all the way down. (Two precision notes against the talk: text, usage, and metadata events are wrapped as [`.response(entryID:action:)`](https://developer.apple.com/documentation/foundationmodels/languagemodelexecutorgenerationchannel), the form Apple's own channel example uses, with sibling `.toolCalls` and `.reasoning` constructors for those event kinds, and `appendText` carries a [`TextFragment`](https://developer.apple.com/documentation/foundationmodels/languagemodelexecutorgenerationchannel/textfragment), whose `content` is a `String`, rather than a bare `String` passed directly.)

## Approximate or throw, and the capability escape hatch

When a model can't honor a request exactly, the framework's guidance is to honor the _intent_ where an honest approximation exists, and to throw a built-in error where none exists.

```swift
// Honor the intent where you can.
if request.generationOptions.samplingMode == .greedy {
    serviceRequest.temperature = 0   // approximate greedy decoding
}

// Throw a built-in error where you can't: no honest approximation exists.
if let schema = request.schema,
   let budget = request.generationOptions.maximumResponseTokens,
   budget < minimumTokens(for: schema) {
    throw LanguageModelError.unsupportedCapability(.init(
        capability: .guidedGeneration,
        debugDescription: "Token budget too small to satisfy this schema."
    ))
}
```

Throwing a built-in [`LanguageModelError`](https://developer.apple.com/documentation/foundationmodels/languagemodelerror) rather than a bespoke one is the smart call. A Foundation Models developer already knows how to catch these cases, so a new model slots into existing error handling with nothing to learn. The enum carries nine cases, and matching the right one to the right situation is most of the job:

| Case | When it fires |
| --- | --- |
| `contextSizeExceeded` | Transcript outgrew the context window; trim and retry |
| `rateLimited` | Too many requests; back off |
| `refusal` | Model declined; fall back to our own message |
| `timeout` | Generation took too long before a response |
| `guardrailViolation` | Safety guardrails tripped on prompt or response |
| `unsupportedCapability` | A used feature isn't declared in `capabilities` |
| `unsupportedTranscriptContent` | Prompt carries content the model can't process |
| `unsupportedGenerationGuide` | A guide (such as a regex) isn't supported |
| `unsupportedLanguageOrLocale` | The requested language or locale isn't supported |

Custom error types stay reserved for failures that only make sense in one service, like a subscription tier or a suspended account. Each custom case is one more thing every app must learn and catch, so the bar for adding one is high.

There's a subtlety here that makes the design tighter than it first looks. The framework gatekeeps the capabilities a model _declares_: if a request uses a feature the model never advertised, the system throws `unsupportedCapability` before `respond` is ever called. The executor doesn't re-validate what it already promised. It throws only for runtime conditions it couldn't know up front, like the token budget above. Declaring capabilities accurately becomes enforcement, not documentation.

## Auth is an argument about human nature

Apple's authentication guidance reads like a security checklist, but it carries an API-design opinion underneath: make the secure path the easy path, because developers take the path of least resistance. If a model's initializer accepts a raw API-key `String`, that key ends up in the binary, in source control, on a developer's laptop. So the advice is to refuse the easy-but-wrong shape, offer token providers or sign-in instead, persist tokens in the [Keychain](https://developer.apple.com/documentation/security/keychain-services), and rely on [App Attest](https://developer.apple.com/documentation/devicecheck/dcappattestservice) for device attestation.

The ecosystem already validated this. Anthropic's [ClaudeForFoundationModels](https://github.com/anthropics/ClaudeForFoundationModels) ships the exact shape session 339 recommends:

```swift
import ClaudeForFoundationModels

// Dev convenience.
let dev = ClaudeLanguageModel(
    name: .sonnet4_6,
    auth: .apiKey(ProcessInfo.processInfo.environment["ANTHROPIC_API_KEY"] ?? "")
)

// Production: a relay at baseURL adds the credential; no raw key in the app.
let prod = ClaudeLanguageModel(
    name: .sonnet4_6,
    auth: .proxied(headers: backendHeaders),
    baseURL: URL(string: "https://api.yourapp.com/claude")!
)

let session = LanguageModelSession(model: prod)
```

The `.apiKey` case exists for the laptop. The `.proxied` case is the one we ship, routing through a backend that holds the credential so the app never does. The API turns the production-safe choice into a different enum case, so it stops being a discipline we have to remember. That's the whole point. (ClaudeForFoundationModels is Apache-2.0 and in beta; its exact surface, the model roster and the auth cases, may shift before GA, so this is one to track against Anthropic's repo, not Apple's docs.)

## How Claude and Gemini already plug in

The partner announcements look different once the protocol is in view. `ClaudeLanguageModel` conforms to the exact `LanguageModel` protocol shown above, with no special-cased Apple partnership and no private back door. So does Google's Gemini, which rides in through the [Firebase Apple SDK](https://firebase.google.com/docs/ai-logic/apple-foundation-models-framework/get-started) in public preview, where a Firebase AI service vends a Gemini-backed `LanguageModel` via `ai.geminiLanguageModel(name:)` rather than a type we construct directly. Both arrive at the identical call site: `LanguageModelSession(model:)`. Apple's own pages don't name either package. Strip away the "partner" framing and what's left is an open protocol with a public surface, where Anthropic's and Google's packages happen to be the first two that conformed. The third one is anyone's to write.

That's also why the extension story holds together for things Apple hasn't built. New modalities ride in through [custom segments](https://developer.apple.com/documentation/foundationmodels/transcript/customsegment), which are `PromptRepresentable`, so a developer passes audio or video straight into a prompt like text and never leaves `LanguageModelSession`:

```swift
public struct AudioSegment: Transcript.CustomSegment {
    public var id: String
    public var content: URL
}

let recording = AudioSegment(id: UUID().uuidString,
                             content: URL(filePath: "/path/to/recording.m4a"))
let response = try await session.respond {
    "Where was Frank Lloyd Wright's original architecture school located?"
    recording
}
```

The executor receives that not as a top-level entry but as a `.custom` segment inside the prompt entry, so it descends into `prompt.segments` and switches on the [segment cases](https://developer.apple.com/documentation/foundationmodels/transcript/segment): `.text`, `.attachment`, `.structure`, and `.custom`. (Two names to get right: custom content is a `.custom` segment, not its own entry type, and the structured case is `.structure`, not `.structured`.) Results flow back through the same channel with [`updateCustomSegment`](https://developer.apple.com/documentation/foundationmodels/languagemodelexecutorgenerationchannel/response/action-swift.enum/updatecustomsegment(_:)), and the segment's `id` decides whether each event adds a new segment or updates one already in flight. The extension point is the same shape as everything else: typed, streamed, behind the session.

The session also pitched a heaviest tier here, server-side tools (web search, code execution) at three visibility levels: private grounding, citation metadata attached to text, or the tool's full structured output surfaced as a custom segment. That surface was slide-only in the talk, with no matching documented symbol, so treat it as the direction the session showed rather than an API to write against yet.

## The honest caveats

Apple over-claimed twice, and the truer versions are more interesting anyway.

The first is "everywhere Swift runs, including Linux." As of this writing, Apple has not open-sourced the _core_ Foundation Models framework. There's no public repo for it. What Apple opened, per the session, is the companion layer (utilities, Core AI model implementations, an MLX integration) and, more to the point, the _protocol surface_. That's the better claim. An open framework would give us a code dump, while an open protocol with first-party conformers from two frontier labs gives us an ecosystem, the thing that makes "any model, one session" true. Framing the openness as the interface rather than the implementation is both accurate and the stronger argument.

The second is "swap models with no code changes," which holds for the app developer alone. The person writing the executor is doing real work: transcript translation, cache diffing against the previous transcript, mapping a backend's error taxonomy onto `LanguageModelError`, deciding what to approximate and what to refuse. The magic is real, but Apple didn't make it free. They moved it, from every app to one package per model. That's the trade, and it's a good one, though "no code changes" describes the consumer and not the author.

## What it means for how we build

The protocol reframes the oldest question in this space, build versus buy, into something more granular: which model, per call. We can prototype a feature on the free on-device model, route the hard queries to a frontier model, and self-host an open-weights model for the privacy-sensitive path, all behind one `LanguageModelSession`, all selected at the call site. The model is no longer an architectural commitment; it's a dependency line. Once that's true, the interesting engineering moves down a layer, into the executor and into the primitives the session already gives us for free: structured output, tools, [Dynamic Profiles](/posts/foundation-models-dynamic-profiles/) as the agent layer that rides on top of any conforming model, and [Apple's own keyless server model as another conformer](/posts/foundation-models-private-cloud-compute/).

That's the bet, stated plainly. Apple is wagering that the durable value lives in the client and its primitives, not the model. If the bet holds, "which model" becomes the least interesting decision in the stack: a line in a SwiftPM file. The work that used to be reinvented in every app moves with it. The agent loop you'd otherwise [hand-roll](/posts/s01-the-agent-loop/), the [context compaction and transcript trimming](/posts/s06-context-compaction/), the streaming, and the tool dispatch all become a system concern you inherit. You write the executor once, or depend on someone who did, and you spend your time on the thing that was always the product: what the model should _do_, and proving that it does it. Thanks for reading!
