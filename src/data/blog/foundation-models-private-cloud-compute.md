---
title: "A Server LLM With No API Keys: Private Cloud Compute in the Foundation Models Framework"
author: "Ivan Magda"
pubDatetime: 2026-06-18T09:00:00Z
slug: "foundation-models-private-cloud-compute"
featured: false
draft: false
tags:
  - wwdc
  - foundation-models
  - apple-intelligence
  - swift
description: "Private Cloud Compute gives apps a 32K-context server model with reasoning and no API keys and makes the per-user daily quota a UI design problem."
---

Adding a server-side LLM to an app has a well-known shape: pick a provider, create an account, generate an API key, figure out where to hide that key (not in the binary), set up a proxy server so it never touches the client, wire up billing alerts, and then watch the per-token costs scale with your user count. The model is the easy part; the keys and the bill are most of the project.

At WWDC26, Apple shipped a server model with none of that. [`PrivateCloudComputeLanguageModel`](https://developer.apple.com/documentation/foundationmodels/privatecloudcomputelanguagemodel) runs on the same Private Cloud Compute infrastructure behind Apple Intelligence and plugs into the Foundation Models framework as a one-line change — no account setup, no authentication, no API keys, and no cloud API cost to us as developers. The trade: it needs iOS 27, an entitlement, and each user gets a daily request limit.

In this post, let's wire the new server model into an app. We'll look at what the model offers over its on-device sibling, what reasoning costs in practice, and spend most of our time on the part I think deserves the spotlight: handling the usage quota as a designed UI state instead of a caught exception.

_This is the second post in a series on the WWDC26 Foundation Models updates. The [overview](/posts/wwdc26-foundation-models-year-two/) sets the context, and the [Dynamic Profiles deep dive](/posts/foundation-models-dynamic-profiles/) covers combining this model with on-device ones in a single session._

## One line to a server model

Let's say that we're building a read-it-later app, and we want a summarization feature that handles full-length articles. The on-device baseline from last year is three lines:

```swift
import FoundationModels

let session = LanguageModelSession()
let response = try await session.respond(to: "Summarize this article: \(article)")
```

Pointing the same feature at the server model changes exactly one of them:

```swift
let session = LanguageModelSession(
    model: PrivateCloudComputeLanguageModel()
)
let response = try await session.respond(to: "Summarize this article: \(article)")
```

That's the whole integration. Because the framework presents one Swift API regardless of which model backs the session, everything we already use keeps working unchanged: `@Generable` structured output, `Tool` calling, streaming. A session with tools and a typed response looks the same on PCC as on-device; only the `model:` argument differs.

What we get for that one line is a much larger model: a **32K-token context window** (the on-device model's is 4K), support for **reasoning**, and enough capability for the workloads the small model struggles with — long documents, heavy multi-step tool calling, synthesis across large inputs. It even works from **watchOS**, putting a server-class LLM behind a watch app with zero key management.

Privacy is the part Apple leads with: requests to PCC are never stored, used only to serve the request, and security researchers can verify the claims independently. The practical payoff for us: escalating a feature from on-device to server doesn't change what we promise users about their data.

## The trade-off, in one table

Apple's documentation carries a comparison table for choosing between the two models, and it's worth reproducing because the decision shows up in every feature we design:

|                | On-device     | Private Cloud Compute |
| -------------- | ------------- | --------------------- |
| Privacy        | Preserved     | Preserved             |
| Connectivity   | Works offline | Requires internet     |
| Request limits | None          | Daily per-user limit  |
| Context size   | 4K            | 32K                   |
| Reasoning      | Not supported | Multiple levels       |

Two rows do most of the work. _Request limits_: the on-device model is free and unlimited, while every PCC request spends from a finite daily allowance that belongs to the user, not to us. _Context size and reasoning_: 32K plus reasoning unlocks tasks the 4K model can't attempt.

Apple's recommended workflow follows directly: start on-device, and escalate to PCC only when the feature demonstrably needs more context or more reasoning. The on-device model was rebuilt this year — better instruction following, better tool calling, image input, so assumptions from last year about what it can't do are worth re-testing before reaching for the server.

## Reasoning spends the context window

Reasoning is the headline capability, and its mechanism is concrete: the model generates extra text — a separate reasoning segment in the session transcript before producing the response. The level is passed per-request through the new `contextOptions` argument:

```swift
let response = try await session.respond(
    to: "Which of these five articles should I read first, and why?",
    contextOptions: ContextOptions(reasoningLevel: .moderate)
)
```

The framework provides [three reasoning levels](https://developer.apple.com/documentation/foundationmodels/contextoptions/reasoninglevel-swift.enum): `.light`, `.moderate`, and `.deep` (the API also carries a [`.custom` escape hatch](https://developer.apple.com/documentation/foundationmodels/contextoptions/reasoninglevel-swift.enum/custom(_:))) and Apple's docs suggest starting at `.moderate`, stepping up to `.deep` only for tasks with competing constraints. On a Dynamic Profile, the same knob is the `.reasoningLevel(_:)` modifier; `contextOptions` is the per-request override, and call-site options win.

Three design consequences follow from reasoning being real generated text:

- Reasoning consumes the context window. At `.deep`, the reasoning segment can run longer than the answer itself, and all of it counts against the 32K budget. A long-document feature that also reasons deeply can run out of room faster than expected.

- The reasoning text lands in the transcript rather than the response. The final response never includes it, but we can read the transcript's reasoning segments to understand _why_ the model answered the way it did — useful when debugging a prompt that produces confident nonsense.

- And the wait needs UI. A `.deep` request can take long enough that a spinner feels broken. Since reasoning streams into the transcript as it's generated, observing the transcript is the supported way to drive progress UI while the model thinks.

## Handling the PCC quota limit: a UI state, not an error

Now for the centerpiece. Each user gets a daily request limit. Apple's docs call it a per-user request budget and iCloud+ subscribers can get more access. The budget belongs to the user rather than to our app, so other apps PCC requests presumably draw from the same pool. Apple hasn't published the exact numbers, nor said what one "request" covers, but a `respond` that loops through several tool calls may spend more than one and the design lesson doesn't depend on either: some users will hit the limit, and what happens next is up to us.

When a user over their limit calls `respond`, the framework throws specifically [`PrivateCloudComputeLanguageModel.Error.quotaLimitReached`](https://developer.apple.com/documentation/foundationmodels/privatecloudcomputelanguagemodel/error/quotalimitreached(_:)), so the path of least resistance is a `catch` block that pops an alert. Apple's session argues, and I agree, that this is the wrong pattern. An alert implies something went wrong and disappears when dismissed, but the quota is neither wrong nor temporary — it stays exhausted until it resets. The user dismisses the alert, taps the button again, and gets the same alert. Nothing in the UI tells them the feature is unavailable _before_ they try.

The framework gives us what we need to do better: [`model.quotaUsage`](https://developer.apple.com/documentation/foundationmodels/privatecloudcomputelanguagemodel/quotausage-swift.property), a queryable state we can drive persistent UI from, before any request is made. There are three pieces: a [`status`](https://developer.apple.com/documentation/foundationmodels/privatecloudcomputelanguagemodel/quotausage-swift.struct/status-swift.property) that reports [`.belowLimit`](https://developer.apple.com/documentation/foundationmodels/privatecloudcomputelanguagemodel/quotausage-swift.struct/status-swift.enum/belowlimit(_:)) with an [`isApproachingLimit`](https://developer.apple.com/documentation/foundationmodels/privatecloudcomputelanguagemodel/quotausage-swift.struct/status-swift.enum/belowlimit/isapproachinglimit) flag, an [`isLimitReached`](https://developer.apple.com/documentation/foundationmodels/privatecloudcomputelanguagemodel/quotausage-swift.struct/islimitreached) Bool, and a [`limitIncreaseSuggestion`](https://developer.apple.com/documentation/foundationmodels/privatecloudcomputelanguagemodel/quotausage-swift.struct/limitincreasesuggestion-swift.property) that can present the upgrade path. Here's the footer of our summarizer view, handling all three:

```swift
private let model = PrivateCloudComputeLanguageModel()

var body: some View {
    ...
    if model.quotaUsage.isLimitReached {
        Text("Usage limit exceeded.")
            .foregroundStyle(.red)
    } else if case .belowLimit(let info) = model.quotaUsage.status,
              info.isApproachingLimit {
        Text("Nearing usage limit.")
            .foregroundStyle(.orange)
    }
    if let suggestion = model.quotaUsage.limitIncreaseSuggestion {
        Button("Show options") {
            suggestion.show()
        }
    }
}
```

With that in place, the pieces are on screen: a persistent label explains the state, and the "Show options" button gives the user an actionable path to a higher limit. The natural next step is wiring the same check into the summarize button's `.disabled(_:)`, so a request that would fail can't start.

We'll want to keep the approaching-limit branch in that footer, too. A user near their daily ceiling is making spending decisions — whether to use their remaining requests here or save them for another app. There's also [`quotaUsage.resetDate`](https://developer.apple.com/documentation/foundationmodels/privatecloudcomputelanguagemodel/quotausage-swift.struct/resetdate) for telling the user when their allowance refreshes (`nil` when the date is unknown or the user is comfortably below the limit).

Quota is orthogonal to availability: the model can report itself fully available while the user's budget for the day is already spent, which is why this UI has to come from `quotaUsage` and not from the availability check. That's the difference between rate limiting and a daily quota, there's no retry-after-a-beat here, only a reset tomorrow or an upgrade today, and those are the two paths the UI should present. The `catch` for `quotaLimitReached` stays as the backstop, though `quotaUsage` is a snapshot, and a request can still race past the limit.

## Faking every availability state in Xcode

Testing this UI used to be the painful part, nobody wants to burn a real daily quota to see an orange label. Xcode 27 ships a scheme option for this: **Run → Options → Simulated Apple Foundation Models Availability**, with five states to flip through:

- Off
- Device Not Eligible
- Model Not Ready
- Approaching Quota Usage Limit
- Quota Usage Limit Reached

The two quota states exercise both branches of the footer above without spending anything. Device Not Eligible and Model Not Ready match the availability enum's unavailable reasons, which the pre-flight checklist below covers.

## The pre-flight checklist

A few things have to be true before any of this runs in production.

First, the availability check - an enum with typed unavailability reasons we can branch on, and the reasons match the Xcode simulator states above:

```swift
switch model.availability {
case .available:
    // show the summarization UI
case .unavailable(.deviceNotEligible):
    // fall back — this device can't use PCC
case .unavailable(.systemNotReady):
    // PCC isn't ready yet — try again later
case .unavailable(_):
    // unknown reason — fall back
}
```

Next, the OS floor. `PrivateCloudComputeLanguageModel` ships in iOS 27, macOS 27, watchOS 27, and visionOS 27, so the real availability check starts with `#available(iOS 27.0, *)` and falls back to [`SystemLanguageModel`](https://developer.apple.com/documentation/foundationmodels/systemlanguagemodel) on older systems.

There's also the network to plan for. PCC needs connectivity, so a request can fail in the field even when availability said yes. Apple's guidance: on a network failure, retry the request on the on-device model. For our summarizer, a 4K-window fallback might mean summarizing the first section instead of the full article — a degraded answer, but an answer.

Finally, the entitlement. Access is gated by a managed entitlement, `com.apple.developer.private-cloud-compute`, requested through [Apple's developer site](https://developer.apple.com/private-cloud-compute/). Eligibility for the no-cloud-API-cost program has three conditions, and all of them have to hold: enrollment in the App Store Small Business Program, fewer than 2 million first-time app downloads across all of our apps on the App Store Connect, and the entitlement assigned to the developer account. Outgrow either of the first two and Apple sends a notice with a six-month window to migrate off. The application is open now, which is worth doing early even for an experiment: the entitlement is the long pole in trying any of this on a real device.

## Let the pass rates pick the model

Apple kept repeating one piece of advice. Measure every choice in this post: on-device or PCC, which reasoning level, whether the fallback is good enough. The new Evaluations framework is built for it. Build a dataset for the feature, score the on-device model's output against PCC's, and let the pass rates decide. The rebuilt on-device model "may surprise you," as the session puts it, and every request it handles costs the user nothing from their quota.

Until now, the blocking question for a server-LLM feature was "can we afford it?" keys, proxies, per-token bills. For eligible apps, PCC retires that question and leaves a better one: does this feature need a server model at all? A server-class model behind a one-line switch leaves us with the real work: deciding what the model should do, and verifying that it does it.

In the [next post](/posts/foundation-models-dynamic-profiles/), we'll look at what happens when one session needs _both_ models: routing creative work to PCC and quick lookups on-device, with the conversation history riding along, courtesy of the new Dynamic Profiles API. Thanks for reading!
