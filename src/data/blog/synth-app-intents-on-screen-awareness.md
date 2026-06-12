---
title: "Becoming Part of the System: Why App Intents Need On-Screen Awareness to Pay Off"
author: "Ivan Magda"
pubDatetime: 2026-06-09T11:00:00Z
slug: "app-intents-on-screen-awareness"
featured: false
draft: false
hideFromFeed: true
tags:
  - app-intents
  - apple-intelligence
  - siri
  - spotlight
  - wwdc
description: "Discoverability and actionability are two separate contracts. App Intents schemas tell the system what our content is; the View Annotations API tells it what's on screen right now. We need both to become part of the intelligent fabric."
---

Two requests to Siri, back to back: "who's coming to origami night?", then "text Richard, can you make one of the pizzas vegetarian?" The first is a question about our content. The second is an action on something that's on screen. They feel like one feature, but they ride on two completely separate contracts — and WWDC 2026 shipped the second one.

The first is a _data contract_: schemas and a semantic index that tell the system what our content and actions are. The second is an _on-screen contract_: the new View Annotations API that tells the system what the user is looking at right now and maps it back to those same entities. Either one alone leaves a gap. Together they're what Apple means when it talks about an app becoming "part of the intelligent fabric of the system."

Let's build up both contracts and see why neither one pays off without the other.

## The data contract: what our app is

The App Intents framework is how the platform learns what our app can do ([App Intents and Apple Intelligence](https://developer.apple.com/documentation/appintents/apple-intelligence-and-siri-ai)). We describe content with entity schemas and actions with intent schemas — structures Siri understands deeply because they've been trained on for years. Entity schemas pull double duty: by conforming our entities to `IndexedEntity` and indexing them, we contribute our content to the Spotlight semantic index, which is what lets the system surface information from our app with attribution back to it ([Spotlight search tool](https://developer.apple.com/documentation/corespotlight/spotlight-search-tool)). In code, that's mostly conformance and a macro:

```swift
// @AppEntity ties this type to a system schema Siri already understands;
// IndexedEntity lands it in the Spotlight semantic index, with attribution to us.
@AppEntity(schema: .messages.message)
struct MessageEntity: IndexedEntity {
    let id: String

    @Property(title: "Sender")
    var sender: ContactEntity
    var text: String

    var displayRepresentation: DisplayRepresentation {
        DisplayRepresentation(title: "\(sender.name)", subtitle: "\(text)")
    }
}
```

Note how little we're inventing here. The schema is system-defined, so Siri's understanding of it keeps improving across new languages and dialects without us touching this code ([Making actions and content discoverable by Apple Intelligence](https://developer.apple.com/documentation/appintents/making-actions-and-content-discoverable-by-apple-intelligence)). Index these entities at launch, and Siri can already answer "who's coming to origami night?" from our data. That's the data contract working: discovery and reasoning over what our content _is_.

## The on-screen contract: what the user is looking at

"Who's coming?" is a question. "Text Richard" is an action, and the moment the user says "send this photo" or "the second message," the system has to resolve a reference to whatever is on screen right now. The data contract can't do that — it knows our entities exist, but not that the second row in the visible list is one of them.

That's the gap the View Annotations API fills ([Platforms State of the Union, WWDC26](https://developer.apple.com/videos/play/wwdc2026/102)). We annotate the visible view with the entity it represents, so that entity can flow into our app's intents:

```swift
MessageRow(message)
    .userActivity("com.origami.ViewingMessage", element: message.entity) { msg, activity in
        activity.appEntityIdentifier = EntityIdentifier(for: msg)
    }
```

With that binding in place, "the second message" resolves to a real `MessageEntity` the system can act on. The action itself is just an intent on a system schema, so "text Richard" maps to a `sendMessage` the model already understands:

```swift
@AppIntent(schema: .messages.sendMessage)
struct SendMessageIntent: AppIntent {
    @Parameter var recipient: ContactEntity
    @Parameter var content: String

    func perform() async throws -> some IntentResult {
        try await messenger.send(content, to: recipient)
        return .result()
    }
}
```

Together they turn reasoning into action: the annotation ties the visible UI to the same entity graph the schemas described, and the intent gives Siri a verb to run against it.

## Why neither half pays off alone

The two contracts only deliver together, and the failure modes when one is missing are concrete. Ship schemas without view annotations, and Siri can find and reason over our content but can't act on on-screen references — "send this one" has nothing to bind to, so we get a smart search box and a dead end at the point of action. Ship view annotations without schemas, and we've mapped views to entities the system has no schema to reason about and no index entry to discover — we've wired the UI to entities the system can't understand.

Discoverability and actionability are different problems. We solve the first once, by describing our domain to the system. We solve the second continuously, as the user moves through the app, by telling the system which entity each visible view represents. "Part of the intelligent fabric" is the State of the Union's phrase for the moment both hold at once: personal context (entities indexed), common actions (intent schemas adopted), and on-screen awareness (views annotated), all present together.

## The boundary this opens

Wiring an app into system intelligence this deeply also widens its trust surface, which is why Apple pairs the capability with guidance on locking it down. App Intents and the Foundation Models framework are the surface where indirect prompt injection — data exfiltration, unintended actions — has to be mitigated with user confirmations and careful prompt design ([Secure your app: mitigate risks to agentic features, WWDC26](https://developer.apple.com/videos/play/wwdc2026/347)). The "Ready to send it?" confirmation before a Siri-composed message isn't a nicety; it's the mitigation. That's the same privacy-and-trust calculus that decides [where our model should run](/posts/apple-platform-ai-model-strategy/): the more of our app the system can act on, the more carefully we gate the actions.

It's also the same inversion running through the rest of the platform this year. Just as [Dynamic Profiles and Xcode plugins](/posts/dynamic-profiles-xcode-agents/) compose behavior from small declared units, App Intents asks us to declare our domain — entities, actions, and now on-screen bindings — and lets the system work out how a user actually reaches it. We stop scripting interactions and start describing capabilities.

## Two contracts, not one switch

Becoming addressable isn't one switch we flip. It's two contracts we satisfy: describe the domain so the system can find and reason about it, and annotate the views so it can act on what's in front of the user. Ship only the first and we get a search box. Ship both, and the system can operate our app on the user's behalf — which is exactly when those "Ready to send it?" confirmations stop being optional. Thanks for reading!
