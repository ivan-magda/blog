---
title: "Apple Shipped Local RAG and Called It a Search Tool: SpotlightSearchTool in Foundation Models"
author: "Ivan Magda"
pubDatetime: 2026-06-15T09:00:00Z
slug: "foundation-models-spotlight-rag"
featured: false
draft: true
tags:
  - wwdc
  - foundation-models
  - swift
  - ai-agents
description: "SpotlightSearchTool hands a Foundation Models session your Core Spotlight index as a retrieval layer: local RAG with no embeddings, no vector store, no server."
---

One of the quieter things Apple shipped at WWDC26 is a retrieval layer, and it arrived wearing the label of a search tool. A typical retrieval-augmented stack has five moving parts: an embedding model, a recompute step that re-embeds content on every edit, a vector store to operate, a chunking strategy to tune, and a server to host the whole thing along with its privacy and compliance surface. [`SpotlightSearchTool`](https://developer.apple.com/documentation/corespotlight/spotlightsearchtool) replaces all five with a one-line [`Tool`](https://developer.apple.com/documentation/foundationmodels/tool) over an index our app may already populate. The session states the thesis in one sentence: _"We're not writing search queries anymore. We're providing the content, and letting intelligence do the rest."_

The way to read this: Apple didn't invent local RAG so much as it connected a model to infrastructure that already shipped years ago. A fast, on-device, permission-aware, full-text-plus-semantic index has lived on every iPhone since Core Spotlight landed, fed by apps donating content for a decade. The missing piece was a tool that lets a model drive it. WWDC26 supplied that piece, so the question stops being "is this RAG" (it is) and becomes "how much control are we trading for the convenience."

_This is a deep dive in a series on the WWDC26 Foundation Models updates. The [Year Two overview](/posts/wwdc26-foundation-models-year-two/) sets the context and the one-paragraph teaser this post expands. The [Private Cloud Compute deep dive](/posts/foundation-models-private-cloud-compute/) covers the server model some of this can run on, and the [Dynamic Profiles deep dive](/posts/foundation-models-dynamic-profiles/) covers the other agent primitive in this year's release. Everything below comes from the first iOS 27 / macOS 27 developer betas. Most of these APIs are marked Beta in Apple's documentation, and details may shift before the fall release; the anchor session is [LLM search using Core Spotlight](https://developer.apple.com/videos/play/wwdc2026/246/)._

## The economics are the whole story

"Chat with your data" features usually die at the infrastructure estimate, not at the model. Someone scopes the feature, totals the plumbing from the paragraph above, multiplies it by a privacy review, and moves the feature to "next quarter." The bottleneck was the plumbing.

`SpotlightSearchTool` removes that plumbing. The index belongs to the user, lives on the device, comes permission-scoped, and the OS maintains it. The data never leaves the phone. There's no embedding bill, no chunking strategy to maintain, no retrieval glue to write, and no server to harden. For a notes app, a journal, a media library, or a recipe box, the cost that made the feature uneconomical is gone.

The entire integration is this, straight from Apple's documentation:

```swift
import CoreSpotlight
import FoundationModels

let tool = SpotlightSearchTool(configuration: .init())

let session = LanguageModelSession(tools: [tool])
let response = try await session.respond(to: "Find my notes about the project deadline.")
```

That's the argument in code form. The "no plumbing" claim lives in how little this is: a default tool, handed to a [`LanguageModelSession`](https://developer.apple.com/documentation/FoundationModels/LanguageModelSession), plus a natural-language prompt. An empty `Configuration` is enough to start, since the tool searches the app's Spotlight index by default and we can name narrower sources later. The work that usually fills a sprint is now a system responsibility, and the contrast is sharpest against a bare session: hand the same prompt to `LanguageModelSession()` with no tools and the model answers from its training, not from one user's actual notes. The tool is the bridge from world knowledge to app knowledge, and the model decides on its own when to cross it.

## What we gave up

The price is worth naming. Consider the trajectory the model runs: it generates a query, invokes the tool, Spotlight executes the query against the index, the model reads a description of the result set, then the model writes its response. Five stages, and our code authors none of them.

![Diagram: the five-step retrieval trajectory from prompt to response, marking which steps the model runs and which Spotlight runs.](/diagrams/spotlight-retrieval-trajectory.svg)

_One prompt, five steps. The model writes the query and reads the results; Spotlight only runs the search._

That's the trade, and it belongs in the headline rather than a footnote. We don't own the retrieval loop. We don't write the query; the model does, in Spotlight's own structured query language, and it may run the loop more than once per answer, refining or broadening as it goes. We don't control the ranking. We don't chunk anything. For a large class of apps that's the right deal, because the retrieval logic we'd have written would have been worse than what Spotlight already does and far more expensive to maintain. It's still a deal, and anyone who needs to own ranking or query shape is shopping in the wrong aisle.

The one lever we keep, and it matters more than it looks, is which attributes the model gets to see. That's where "index quality is the retrieval ceiling" becomes concrete. Rather than the bare `.coreSpotlight` shorthand, the richer path constructs a [`CoreSpotlightSource`](https://developer.apple.com/documentation/corespotlight/corespotlightsource) and sets what the model can reason over:

```swift
var csSource = CoreSpotlightSource(fetchAttributes: [.subject, .authorNames, .contentDescription])
csSource.sourceOptions = [.allowMail]
csSource.maximumResultCount = 20

let configuration = SpotlightSearchTool.Configuration(sources: [.coreSpotlight(csSource)])
let tool = SpotlightSearchTool(configuration: configuration)

let session = LanguageModelSession(tools: [tool])
let response = try await session.respond(to: "Find my notes about the project deadline")
```

`fetchAttributes` is the real dial. Leave it empty and the tool fetches only each item's identifier, which is rarely enough for the model to reason well. Garbage in is now LLM-in: if the index is thin, no amount of model quality rescues the answer. The retrieval ceiling moved from "how good is our embedding model" to "how good is the content we donated," and that's a healthier place for the ceiling to sit, because we control it.

## When to reach for it, and when not to

Before the rest of the tuning, it helps to fix where this tool wins and where it loses against the alternatives. The gate is mostly _where the data lives_ and _who writes the query_:

| Axis | `SpotlightSearchTool` | Embeddings + vector store | Custom `Tool` over a DB | Server-side RAG |
| --- | --- | --- | --- | --- |
| Setup cost | One tool, if already indexed | High: pipeline, store, sync | Medium: we write the query | High: service plus infra |
| Where data lives | On device, in Spotlight | Wherever we host the store | Wherever the DB lives | Our servers |
| Retrieval style | Keyword plus semantic, via Spotlight | Semantic embeddings | Whatever we code | Whatever we build |
| Who writes the query | The model | We do (embed the prompt) | Model picks args, we query | Usually we do |
| Offline | Yes | Only if fully on-device | If the DB is local | No |

A few rows decide most cases. _Where data lives_ is the first cut: Spotlight holds on-device app content, so a corpus that lives on a server or behind a third-party API falls out of scope however convenient the tool looks. _Retrieval style_ is the next filter: Spotlight gives us its own blend of keyword and semantic matching, not arbitrary cross-document embedding math, so a feature that depends on a specific similarity metric or a custom re-ranker wants the vector-store path. And _who writes the query_ separates the use cases: here the model generates the query and can issue several per answer, which suits conversational search and works against retrieval that has to stay deterministic. Reach for `SpotlightSearchTool` when the corpus is already (or can cheaply become) Spotlight-indexed app content and we want on-device grounding with the model driving retrieval; reach for something else when we need server-side corpora, precise control over the algorithm, or embedding semantics the index doesn't expose.

## The two-surface pattern Apple got right

The piece of API design here worth praising is the split between what the model says and what the app renders.

A "chat over my data" UI has two jobs that pull in opposite directions. It needs a conversational narration, the assistant bubble that says "I found four notes about the deadline." It also needs a source-of-truth list, the actual rows the user can tap. Conflate those and the UI either lies (the bubble's prose drifts from the list) or stutters (the list waits on the prose). Apple separated them: the result of `session.respond(to:)` carries the concise summary for the bubble, while [`tool.searchResults`](https://developer.apple.com/documentation/corespotlight/spotlightsearchtool/searchresults) is an async stream of the raw items for the list.

The seam between them is a `queryToken`, which exists because the model may run more than one query to answer a single prompt. We consume the stream in a task before responding, and start a fresh display section whenever the token changes:

```swift
let tool = SpotlightSearchTool(configuration: .init())
let session = LanguageModelSession(tools: [tool])

Task {
    var currentToken: SpotlightSearchTool.SearchReply.QueryToken?
    for await reply in tool.searchResults {
        if reply.queryToken != currentToken {
            currentToken = reply.queryToken // new query -> new section
        }
        switch reply.content {
        case .items(let items):
            displayResultsList(label: reply.label, items: items)
        case .scoredItems(let scored):
            displayScoredResults(label: reply.label, scored: scored)
        case .groupedItems(let groups):
            displayGroupedResults(label: reply.label, groups: groups)
        case .count(let count):
            displayCount(count.value, header: count.header ?? reply.label)
        case .statistic(let stat):
            displayMetric(name: stat.name, value: stat.value, header: stat.header ?? reply.label)
        case .table(let table):
            displayTable(table, label: reply.label)
        case .text(let text):
            displayTextBlock(text.body, header: text.header ?? reply.label)
        @unknown default:
            break
        }
        showProgressIndicator(reply.status == .partial)
    }
}

let response = try await session.respond(to: "Show me recent emails from Shelly.")
```

This design puts the model in charge of narration and the app in charge of truth, the seam a data UI needs. The [`SearchReply`](https://developer.apple.com/documentation/corespotlight/spotlightsearchtool/searchreply) also carries a short model-generated `label` and a `status` we can watch for `.partial` to drive progress. One detail keeps the switch honest: the [`SearchReply.Content`](https://developer.apple.com/documentation/corespotlight/spotlightsearchtool/searchreply/content-swift.enum) enum declares seven cases, each with a single associated value, so the loop handles all seven and keeps an `@unknown default` for forward-compatibility. The collection cases bind a payload directly (`.items` an `[CSSearchableItem]`, `.scoredItems` an `[ScoredSearchableItem]`, `.groupedItems` a `[SearchableItemAttribute: [CSSearchableItem]]`); the scalar cases unwrap a struct rather than a tuple: [`SearchCount`](https://developer.apple.com/documentation/corespotlight/searchcount) exposes `value` and `header`, [`SearchStatistic`](https://developer.apple.com/documentation/corespotlight/searchstatistic) exposes `name`, `value`, and `header`. Apple's own article-level sample shows a shorter, multi-value reply loop that wouldn't compile against the shipped enum, so the form above is the one that matches the reference.

## The "new method" that already shipped

One correction reframes what this announcement is.

Some donated metadata, text and HTML in particular, sits in a compact representation that's searchable but not recoverable into LLM-readable form. The model can match against it but can't read it back, so a search can find the right item while the model still has nothing legible to reason over. The symptom is a tool that retrieves correctly and still produces a thin answer. The fix is a delegate hook, [`searchableItems(forIdentifiers:)`](https://developer.apple.com/documentation/corespotlight/cssearchableindexdelegate/searchableitems(foridentifiers:searchableitemshandler:)), wired through `CoreSpotlightSource`, that rehydrates the full items on demand:

```swift
// Existing CSSearchableIndexDelegate method (iOS 18.4+), now used by the search tool.
func searchableItems(forIdentifiers identifiers: [String]) async -> [CSSearchableItem] {
    let entries = await store.fetchEntries(ids: identifiers)
    return entries.map { makeSearchableItem(from: $0) } // attach model-only attributes here
}

// The tool reaches it through the source we configure:
let source = CoreSpotlightSource(searchableIndexDelegate: indexDelegate,
                                 fetchAttributes: [.title])
let tool = SpotlightSearchTool(configuration: .init(sources: [.coreSpotlight(source)]))
```

The session frames this as a new method. The documentation disagrees: `searchableItems(forIdentifiers:)` has been available since iOS 18.4 and macOS 15.4, and the [`CSSearchableIndexDelegate`](https://developer.apple.com/documentation/corespotlight/cssearchableindexdelegate) protocol it lives on dates back to iOS 9. What's new at WWDC26 is the _use_. The search tool now relies on an existing delegate hook to recreate items the index stores too compactly to read.

That distinction repeats throughout the feature: Apple isn't building new retrieval infrastructure, it's connecting a model to infrastructure that already shipped. The move worth noticing sits in the comment in the code above: this hook is where we attach attributes that exist _only_ for the model to reason over, metadata we'd never donate for human-facing search. We treat the index as our retrieval substrate and use the rehydration hook to enrich it for the model specifically.

## The cost of running on-device

The abstraction shows its seams in one place, and Apple exposed that seam rather than papering over it.

`SpotlightSearchTool` exposes its entire capability set to the model for guided generation: text match, semantic similarity, dates, people, numeric ranges, content types. That's a lot of schema to feed a small on-device model whose context window is tight. The documented on-device window is [4,096 tokens](https://developer.apple.com/documentation/foundationmodels/managing-the-context-window), and the safe move is reading `SystemLanguageModel.contextSize` at runtime rather than hard-coding it; either way, flooding that budget with capabilities our content never uses is wasted space. Apple gives us two levers for it: which capabilities the model is guided on, and how verbose the results are.

The first lever is the guide's level. [`GuidanceProfile`](https://developer.apple.com/documentation/corespotlight/spotlightsearchtool/guidanceprofile) under `.dynamic` declares which techniques and attributes the model may use; `.focused` is the coarse path that scopes to a content domain:

```swift
// Fine-grained: declare exactly which techniques + attributes the model may use.
let profile = SpotlightSearchTool.GuidanceProfile(
    textMatch: true,
    similarityMatch: true,
    numericMatch: false,
    dates: true,
    people: false,      // this app never donates person relationships
    attributes: [.title, .altitude, .completionDate]
)
let tool = SpotlightSearchTool(
    configuration: .init(guide: .init(level: .dynamic(profile)))
)

// Coarse: .focused takes a ContentDomain such as .items, .documents, or .calendar.
let focusedTool = SpotlightSearchTool(
    configuration: .init(guide: .init(level: .focused(.items)))
)
```

The profile's field set is broader than the session let on: `textMatch`, `similarityMatch`, `numericMatch`, `dates`, `people`, `contentType`, and `attributes`, with an unset property disabling that technique, which is why the partial initializer above compiles. There's no `locations` field, despite what the early notes suggested. The `.focused` path takes a [`ContentDomain`](https://developer.apple.com/documentation/corespotlight/spotlightsearchtool/contentdomain), and the built-in domains cover `.items`, `.documents`, `.calendar`, `.communications`, `.audio`, and `.visualMedia`. The default level, `.complete`, exposes every technique.

The second lever is separate: a [`FormatLevel`](https://developer.apple.com/documentation/corespotlight/spotlightsearchtool/formatlevel) on the guide's `format` property controls _how verbose_ the serialized results are. It defaults to `.structured` (full fidelity, highest token cost) and drops to `.compact` (terse, line-oriented) for token-constrained models or long conversations that need to bank context:

```swift
let compactTool = SpotlightSearchTool(
    configuration: .init(guide: .init(level: .focused(.items), format: .compact))
)
```

The two knobs compose: narrow the capabilities _and_ shrink the encoding at once, and on-device the right move is usually both. Treating them as one knob is the easy mistake, since the talk named `.compact` and left the guidance axis implicit. This is the on-device story as engineering rather than magic, and the levers are the point. For a bigger window, the next step is pairing retrieval with a [server model on Private Cloud Compute](/posts/foundation-models-private-cloud-compute/).

## Resolving "I" and "me"

A whole class of useful prompts references a person, often the user: "who did I hike with?" or "show me notes I shared with my partner." The model can't resolve "I" against the index without knowing who the user is, so the tool takes a [`ContactResolver`](https://developer.apple.com/documentation/corespotlight/contactresolver) that supplies the app owner's identity. Skip it, and person-relative prompts come back empty.

The session slide and the docs disagree on where the resolver goes: the slide set `tool.contactResolver` as a property after construction, but the supported surface is the configuration. We adopt the protocol and hand it in through `Configuration`:

```swift
struct MyContactResolver: ContactResolver {
    func userIdentity() -> ResolvedContact {
        var contact = ResolvedContact(displayName: "Jane Doe")
        contact.emailAddresses = ["jane@example.com", "jdoe@work.com"]
        return contact
    }
}

let tool = SpotlightSearchTool(
    configuration: .init(contactResolver: MyContactResolver())
)
```

This is cheap to add and easy to forget, which is what makes it a reliable source of "why does it work for everything except questions about me" bug reports.

## Retrieve, then compute

This part lifts the feature above plain function-calling RAG, and it's where the "it's only a search tool" framing undersells what shipped.

For a complex request, the model can forgo a single query and assemble a _pipeline_: search the index, then count by month, then average. It can register app-defined stages, conforming to [`CustomStage`](https://developer.apple.com/documentation/corespotlight/customstage), drop them into a query plan, and return computed data back to the app. Apple's reference shows a sentiment-scoring stage; the same shape gives us a recency boost that reweights results by how recently they were modified:

```swift
struct RecencyBoostStage: CustomStage {
    static var name: String { "recency_boost" }
    static var description: String { "Boosts recently modified items in the ranking." }
    static var inputTypes:  [SearchPipelineDataType] { [.items] }
    static var outputTypes: [SearchPipelineDataType] { [.scoredItems] }

    var recencyWeight: Double

    func execute(items: [CSSearchableItem]) async throws -> SearchPipelineData {
        let now = Date()
        let scored = items.map { item -> ScoredSearchableItem in
            let age = now.timeIntervalSince(item.attributeSet.contentModificationDate ?? .distantPast)
            let recencyScore = max(0, 1.0 - (age / (30 * 86400)))
            return ScoredSearchableItem(item: item, score: recencyScore * recencyWeight)
        }
        return .scoredItems(scored)
    }
}

extension CustomStage where Self == RecencyBoostStage {
    static func recencyBoost(weight: Double = 0.3) -> Self { RecencyBoostStage(recencyWeight: weight) }
}

let tool = SpotlightSearchTool(configuration: .init(
    sources: [.coreSpotlight],
    customStages: [.recencyBoost(), .recencyBoost(weight: 0.5)]
))
```

A stage declares its input and output data types, implements only the typed `execute` overload that matches its `inputTypes` (`execute(items:)`, `execute(scoredItems:)`, `execute(count:)`, and so on), returns [`SearchPipelineData`](https://developer.apple.com/documentation/corespotlight/searchpipelinedata), and gets registered through a static-factory extension so the model can reference it by name with dot syntax. The session showed a single `execute(on:)` form; the shipped reference uses the typed overloads, and the ones we don't implement throw rather than no-op. One constraint matters, and the docs are firm on it: stages run independently, in parallel, in any order, with no shared state. Transform with immutable values or actors only.

Retrieval here becomes a small, programmable query engine that the model orchestrates, which is more than RAG usually offers. Plain function-calling RAG retrieves and stuffs context; this retrieves, computes over the result set, and can hand structured answers back. The model finds the user's hikes and answers "how many miles a month, on average" by composing search with arithmetic it didn't have to be taught.

## Where this sits, and the verdict

A few cases call for skipping it, since the convenience makes it tempting to reach for everywhere. Skip it when we need to own ranking. Skip it when the corpus isn't Spotlight-shaped: server-side documents, multi-tenant SaaS data, anything that doesn't live on the device. Skip it when we need cross-device retrieval, or when letting the model author the query is a dealbreaker for the domain. The prerequisite also deserves a clear statement: the "one line" framing assumes the app already donates to Core Spotlight. An app that doesn't pays an indexing-adoption cost first, and that lift is real even when it's a good investment on its own.

The obvious fit is a notes, journal, library, or photos-style app whose content already sits in Spotlight, or lands there with little effort. That's the 80% case of consumer apps sitting on local user data, and Apple optimized hard for it: the "works out of the box" path is one line, bought with control we mostly didn't want anyway.

Apple expects this to be tuned like a real retrieval system rather than shipped on vibes, and the measurement story is the tell. The session pairs the tool with the [Evaluations framework](https://developer.apple.com/documentation/evaluations), scoring something like result coverage: how well the model's response covers the items we expected it to find, across a dataset of rephrased queries pinned to expected identifiers. (The specific evaluation symbols and thresholds came from the session, not from dedicated documentation pages, so treat the exact wiring as illustrative until the GM SDK lands.) The point survives the caveat: a retrieval layer we can't measure is a retrieval layer we're shipping on faith, and Apple steers us toward a measured result-coverage number instead. Anyone who's read about [what makes retrieval-augmented features work in practice](/posts/five-things-ai-coding-agents-actually-work/) will recognize the instinct.

Before any of it ships, a short list of things that have to be true:

- Is the content already in Core Spotlight, or cheap to donate?
- Are the attributes the model needs listed in `fetchAttributes`, or recoverable through the rehydration delegate?
- Is guidance narrowed (`.dynamic` or `.focused`) and the format set to `.compact` for on-device models?
- Is a `ContactResolver` supplied if any prompts say "I" or "me"?
- Is there an eval suite with expected identifiers, so quality is a measured result-coverage number rather than a hunch?

Apple shipped local RAG and, with characteristic understatement, called it a search tool. The reframe carries the insight: the hard part of retrieval was never the model, it was the index, and the index already sat on the device, permission-scoped, maintained for free. WWDC26 handed the model a handle to pull it. These are still first-beta APIs, so the newer pieces (the `CustomStage` overloads, the contact-resolver path, the pipeline types) are worth re-checking against the GM SDK before you ship against them. But if you've ever scoped a "chat with your data" feature and abandoned it at the infrastructure estimate, this is the announcement to re-read, because the estimate dropped to near zero, and the one thing left to decide is whether you can live without owning the query. For most consumer apps, you can. Thanks for reading!
