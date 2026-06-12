---
title: "Foundation Models, Year Two: From On-Device API to General LLM Runtime"
author: "Ivan Magda"
pubDatetime: 2026-06-12T14:03:22Z
slug: "wwdc26-foundation-models-year-two"
featured: true
draft: false
tags:
  - wwdc
  - foundation-models
  - apple-intelligence
  - swift
  - ai-agents
description: "WWDC26 turned Foundation Models into Swift's general LLM client: a rebuilt on-device model, a server model with no API keys, and the first real agent primitives."
---

Last June, Apple shipped the Foundation Models framework as a tidy, single-purpose thing: a Swift API to one small language model that lives on the device. It was easy to describe and easy to dismiss — useful for summarization and tagging, too small for anything ambitious, and locked to Apple's own model on Apple's own platforms.

Apple discarded that framing at WWDC26. The session API survives almost untouched, but behind it now sits a model _slot_ rather than a model: Apple's rebuilt on-device model (which can now see images), a server-class model on Private Cloud Compute with reasoning and no API keys, Claude and Gemini through packages from Anthropic and Google themselves, or a local open-weights model running through Core AI or MLX. Around that slot, Apple added the early pieces of an agent runtime — declarative mode switching, built-in tools, local RAG — plus the tooling to debug and measure all of it. Foundation Models is now Swift's general-purpose LLM client.

That's a lot of surface area, so let's treat this post as a map rather than a tour. For the two areas that matter most, I've written dedicated deep dives: [Private Cloud Compute](/posts/foundation-models-private-cloud-compute/) and [Dynamic Profiles](/posts/foundation-models-dynamic-profiles/). I'll keep this overview updated as the cluster grows.

_Everything below comes from the first iOS 27 / macOS 27 developer betas — most of these APIs are marked Beta in Apple's documentation, and details may shift before the fall release. The anchor session is [What's new in the Foundation Models framework](https://developer.apple.com/videos/play/wwdc2026/241/)._

## The on-device model grew eyes

The on-device model was rebuilt this year, with better logic and better tool calling — Apple's own advice is to re-test whatever the old model failed at before assuming we still need a bigger one. The visible new capability is image input: prompt builders now accept an `Attachment` alongside text, taking a `CGImage`, `CIImage`, `CVPixelBuffer`, or an image file URL (Apple's sample code wraps `UIImage` and `NSImage` too), at any size or aspect ratio. In the session's demo, captioning a photo of an origami crane consumed about 323 input tokens — images are tokens like everything else, larger images cost more of them, and the on-device budget is small.

And about that small model: Apple's documentation still puts the on-device window at [4,096 tokens per session](https://developer.apple.com/documentation/foundationmodels/managing-the-context-window); the sessions hint at more on newer hardware, but the docs haven't committed. Either way, the safe move is reading `SystemLanguageModel.contextSize` at runtime and measuring prompts with [`tokenCount(for:)`](<https://developer.apple.com/documentation/foundationmodels/systemlanguagemodel/tokencount(for:)>) — both arrived in iOS 26.4 — instead of hard-coding limits.

## The headline: a server model with no keys

The biggest single announcement is `PrivateCloudComputeLanguageModel` — the server model behind Apple Intelligence, opened to third-party apps through the same session API. Switching a feature from on-device to server is one line:

```swift
let session = LanguageModelSession(
    model: PrivateCloudComputeLanguageModel()
)
```

What that line buys us: a 32K-token context window, reasoning, and availability everywhere from iOS to watchOS 27. What it doesn't require is the apparatus we've learned to associate with server LLMs — no account setup, no auth, no API keys, and no cloud API cost for eligible smaller apps (the bar is App Store Small Business Program enrollment and under 2 million first-time downloads). Users spend from a daily request limit instead, with more access through iCloud+, and the privacy guarantees are independently verifiable rather than promised in a ToS.

A per-user daily quota is a different design constraint than a metered API bill, and handling it gracefully — as persistent UI rather than a caught exception — is the most interesting engineering problem in the whole release. That, plus the real cost of reasoning levels and the availability checklist, is what the [PCC deep dive](/posts/foundation-models-private-cloud-compute/) covers. The short version of the call to action: the managed entitlement (`com.apple.developer.private-cloud-compute`) is the gate, and its [application process](https://developer.apple.com/private-cloud-compute/) is already open.

## One protocol, any model

The change that makes "general LLM runtime" more than a slogan is the new `LanguageModel` protocol. A `LanguageModelSession` is now backed by _some_ language model, and everything downstream — `@Generable` structured output, tool calling, streaming, Dynamic Profiles — works against the protocol, not against Apple's models. Swapping providers is a package import and an init argument.

Anthropic ships [ClaudeForFoundationModels](https://github.com/anthropics/ClaudeForFoundationModels), a beta package whose `ClaudeLanguageModel` drops Claude into any Foundation Models session. Google wires `GeminiLanguageModel` into the Firebase Apple SDK, in preview. Apple published [coreai-models](https://github.com/apple/coreai-models) for running local open-weights models on Apple silicon — the session demos a 4-bit Qwen3 — and an MLX integration is landing in `mlx-swift-lm` for the Mac-GPU crowd. Two frontier labs shipping first-party Swift packages in keynote week — a year ago I'd have called that unlikely.

One framing from the sessions deserves a caveat. Apple pitched the framework as running "everywhere Swift runs, including Linux servers" — but as of this writing there's no public repo for the core framework. What's actually open source is the companion layer: the [Foundation Models framework utilities](https://github.com/apple/foundation-models-utilities) package, Core AI's model implementations, and the provider packages above. The portable-everywhere version may well arrive by GM.

Third-party models mean third-party bills, so Apple put a `usage` property on every response — and an accumulated one per session:

```swift
print(response.usage.input.totalTokenCount)
print(response.usage.input.cachedTokenCount)
print(response.usage.output.reasoningTokenCount)
```

The `cachedTokenCount` field is there for people who watch their KV-cache hit rates because someone is paying per token.

## Agent primitives, no framework required

My favorite part of the release is the smallest-looking one. **Dynamic Profiles** let a single session swap its instructions, tools, model, and generation options declaratively, while the conversation history stays put. A profile is a SwiftUI-style struct whose `body` picks a configuration for the app's current state:

```swift
struct AssistantProfile: LanguageModelSession.DynamicProfile {
    var state: AppState

    var body: some DynamicProfile {
        switch state.mode {
        case .research:
            Profile { ResearchInstructions(); SearchTool() }
                .model(state.pccModel)
                .reasoningLevel(.moderate)
        case .quickAnswers:
            Profile { ConciseInstructions() }
                .model(state.onDeviceModel)
        }
    }
}
```

Two things follow. The body re-evaluates on every prompt and after every tool call, so the model itself can trigger mode switches through tools. And each mode runs on whichever model fits it: server for the hard phase, on-device for the cheap one, with history riding along. Add the lifecycle hooks, history transforms, and the required-tools mode, and what's hiding inside `LanguageModelSession` is a small agent framework. That claim takes a whole post to defend properly, and the [Dynamic Profiles deep dive](/posts/foundation-models-dynamic-profiles/) is that post, including how Apple's patterns map onto the [agent series](/posts/s01-the-agent-loop/) we built from scratch on this blog.

The framework also gained system tools — capabilities we hand to a session without writing them ourselves. `BarcodeReaderTool` and an OCR tool are backed by Vision, covering the things LLMs are bad at. The one to watch is `SpotlightSearchTool`: hand it to a session and the model can search our app's existing Core Spotlight index, the model writes the query, Spotlight runs it, the model reasons over the results. That's local RAG with no embeddings pipeline, no vector store, and no server, built on content many apps have been donating to Spotlight for years. If you've ever scoped a "chat with your data" feature and abandoned it at the infrastructure estimate, this is the announcement to re-read.

## The tooling caught up

Until this year, debugging a Foundation Models feature meant `print` statements and squinting at transcripts. Xcode 27 ships an overhauled Foundation Models instrument that visualizes the whole tool-call loop per request: which instructions were active, what the model decided, where the latency went (time-to-first-token, tokens per second, total). The [debugging session](https://developer.apple.com/videos/play/wwdc2026/243/) does a live root-cause of a silent failure: a prompt referencing a tool that was never attached, no error thrown anywhere and the instrument finds in minutes what log-reading might never surface.

The **Evaluations framework** is the measurement half. It plugs evaluation datasets into Swift Testing, score-carrying reports in Xcode, model judges for qualitative criteria, so questions like "is the on-device model good enough, or do I need PCC?" and "did my prompt tweak help?" get answered with pass rates instead of gut feel. Apple repeats the same advice in nearly every session this year "decide by data, not vibes" and it's hard to argue with: eyeballing three sample outputs was never much of a methodology.

Beyond Xcode, Foundation Models escaped Swift entirely. macOS 27 preinstalls an `fm` command-line tool. Apple hasn't published reference docs for it yet; the beta's own help output lists `respond`, `chat`, `token-count`, `schema`, `serve`, `available`, and `quota-usage`, with `--model pcc` reaching Private Cloud Compute from a shell script:

```bash
fm respond 'Suggest a filename for this draft: ...'
fm respond --model pcc --stream 'Summarize this article'
fm serve   # local Chat Completions API server
```

`fm serve` is the underrated one — a local, OpenAI-compatible endpoint backed by Apple's models means existing tooling can point at an on-device model with a base-URL change. And the Python SDK ([`apple-fm-sdk`](https://pypi.org/project/apple-fm-sdk/), on PyPI since March) mirrors the Swift API, so we can prototype a prompt in a notebook and ship it in Swift against the same surface.

The experimental pieces — the Skills API, history modifiers, the Chat Completions client, all live in the open-source utilities package, which Apple plans to update _between_ OS releases. Apple has never shipped AI building blocks on a GitHub cadence before; plan for this layer to keep moving.

## Where to start

Three concrete moves, in priority order. [Apply for the PCC entitlement](https://developer.apple.com/private-cloud-compute/) approval is the bottleneck for everything server-side, and the application is open now. Download the [Origami sample](https://developer.apple.com/documentation/foundationmodels/origami-crafting-a-dynamic-tutorial-for-apple-intelligence) it's the one codebase where the new model slot, Dynamic Profiles, multimodal prompts, and PCC all appear together. And watch the [utilities repo](https://github.com/apple/foundation-models-utilities) between-release updates mean the interesting changes won't wait for September.

A year ago, Foundation Models was a pleasant curiosity: free, private, small. After this WWDC it reads like a commitment to Swift as a first-class language for AI clients, and to a session API that treats server models and agents as native concerns. The deep dives on [Private Cloud Compute](/posts/foundation-models-private-cloud-compute/) and [Dynamic Profiles](/posts/foundation-models-dynamic-profiles/) pick up from here. Thanks for reading!
