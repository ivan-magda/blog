---
title: "Three Ways to Run a Model on Apple Platforms, and the Question That Picks for You"
author: "Ivan Magda"
pubDatetime: 2026-06-09T09:00:00Z
slug: "apple-platform-ai-model-strategy"
featured: false
draft: false
hideFromFeed: true
tags:
  - apple-intelligence
  - foundation-models
  - core-ai
  - on-device-ai
  - wwdc
description: "After WWDC 2026, Apple platforms give us three distinct ways to run a generative model. The right one is decided by where our data and control must live, not by which model scores highest."
---

Let's say we're adding a feature to our app that turns a user's private notes into a tidy summary. The moment we start sketching it, a question lands on the table: which model runs this? A year ago that had one obvious answer. After WWDC 2026 it has three, and picking the wrong one is the kind of decision that's painful to unwind later.

We can run the on-device system model through the Foundation Models framework, reach a frontier model on Private Cloud Compute, or bring our own weights and run them with the brand-new Core AI framework. The instinct is to rank these by raw capability and grab the biggest one. However, that's the wrong axis. The real decision is about where our data sits, who controls the model, and who pays per token.

In this post, let's walk through the three paths, then pin down the single question that picks between them for any given feature.

## What each path is actually good at

The [Foundation Models framework](https://developer.apple.com/documentation/foundationmodels) is a native Swift API to the same on-device model that powers Apple Intelligence. This year it picked up multimodal prompts with image input, an integrated Vision toolset for OCR and barcode reading, and the ability to call server models. Any provider can ship a Swift package that conforms to the language model protocol, so we can drop Claude, Gemini, or an open-source model into the same `LanguageModelSession` we already use ([What's new in the Foundation Models framework, WWDC26](https://developer.apple.com/videos/play/wwdc2026/241); [Bring an LLM provider to the Foundation Models framework](https://developer.apple.com/videos/play/wwdc2026/339)).

That swap is the part worth internalizing. Reaching for a different model is a parameter on the session, not a rewrite:

```swift
// One session API; the model behind it is a choice, not an architecture.
let session = LanguageModelSession(model: onDeviceModel) { ... }

// Need more horsepower for one task? Same prompts, same tools, bigger model.
let session = LanguageModelSession(model: cloudModel) { ... }
```

Note how the prompts, tools, and guided-generation types wrapped around the session stay put. Only the model behind it moves.

When the on-device model is too small for a task, the framework routes to Private Cloud Compute: a frontier-class Apple model that runs server-side without storing or exposing user data. If our app has fewer than two million first-time App Store downloads, we get it with no cloud API cost ([Build with the new Apple Foundation Model on Private Cloud Compute, WWDC26](https://developer.apple.com/videos/play/wwdc2026/319)), which removes the usual reason a small team never even tries a large model.

And when we already have a specific model we want to run ourselves, that's where [Core AI](https://developer.apple.com/core-ai/) comes in. It's a new framework for bringing our own model and running it on device through a memory-safe Swift API, with control all the way down to custom GPU kernels. Python tools convert and optimize a PyTorch model, Xcode compiles it ahead of time, and the same code scales from a compact vision model on an iPhone to a multi-billion-parameter LLM on a Mac ([Meet Core AI, WWDC26](https://developer.apple.com/videos/play/wwdc2026/324); [Core AI documentation](https://developer.apple.com/documentation/coreai)). It runs with zero server dependencies and zero token cost.

## The question that actually decides it

So we have three good options, and the trap is comparing them on capability alone — because each one trades something different. Let's line them up against the three constraints that matter:

- **On-device Foundation Models** keeps data on the device, gives us Apple's weights rather than our own, and costs nothing. Its ceiling is the capability of a small model.
- **Private Cloud Compute** keeps that privacy guarantee while raising the ceiling to frontier level, in exchange for a network dependency and an availability check we handle gracefully.
- **A third-party server model** offers the most capability and the least control: data leaves the device under that provider's terms, and we own the API bill.
- **Core AI** is the one path where we own the weights. Data never leaves the device, there's no token cost, and we set the performance envelope — in exchange for owning the conversion, optimization, and app-size work.

With that on the table, the deciding question isn't "which model is best." It's two smaller ones: does this feature need weights we control or a capability we can't get on device, and can the data ever leave the phone? Our private-notes summarizer answers itself — it wants the on-device model or Core AI, never a third-party server. A feature that needs a frontier model over private data wants Private Cloud Compute. A custom domain model we've already trained wants Core AI.

What keeps this from being four separate architectures is that the Foundation Models framework is the single front door for everything except our own weights. We write against one session API and change the model with a parameter, so the privacy-versus-capability call becomes a configuration choice late in development, not a commitment we make on day one. Core AI sits beside that door for the one case the framework leaves out: running a model we brought ourselves.

## One more thing the size of the model decides

There's a security angle that's easy to miss. The moment a feature calls tools or acts on a model's output, prompt injection turns into a real threat, and Apple treats App Intents plus Foundation Models as the surface to defend ([Secure your app: mitigate risks to agentic features, WWDC26](https://developer.apple.com/videos/play/wwdc2026/347)). That nudges the same decision in a second direction: an on-device or Private Cloud Compute path keeps untrusted content inside a privacy boundary we can reason about, while a third-party server path widens the trust surface. The blast radius scales with the model's reach, not only its capability.

This is the same model-selection problem that shows up the moment we start composing models into agents, where the per-step choice of fast-and-local versus slow-and-capable shapes the whole system. [The agent abstraction, top to bottom](/posts/dynamic-profiles-xcode-agents/) looks at how Dynamic Profiles let us make that choice per turn inside one session. And once the framework goes open source, the device-versus-server line blurs even further — [End-to-end Swift AI](/posts/end-to-end-swift-ai-device-to-server/) follows that thread out to the server.

## Pick the constraint that can't move

The takeaway is smaller than the three-framework lineup makes it look. We pick the path by the constraint that can't move — the privacy boundary, or who owns the weights — and treat capability as the thing we tune afterward. For most features that means starting on the on-device model, shipping, and reaching for a bigger model with a one-line change only once we know what the feature actually needs. Capability is the easy dial to turn later; the boundary is the one we'd have to rebuild around. Thanks for reading!
