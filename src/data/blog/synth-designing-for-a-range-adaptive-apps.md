---
title: "Designing for a Range, Not a Device: Adaptivity Became the Default in 2026"
author: "Ivan Magda"
pubDatetime: 2026-06-09T10:30:00Z
slug: "designing-for-a-range-adaptive-apps"
featured: false
draft: false
hideFromFeed: true
tags:
  - swiftui
  - liquid-glass
  - app-adaptability
  - xcode
  - wwdc
description: "WWDC 2026 made adaptivity the default with auto-opt-in resizability, self-adapting Liquid Glass, and priority-driven toolbars, then shipped a coding-agent skill to retrofit the apps that weren't built for it."
---

Rebuild our iOS app with the new SDK, open it on an iPad through iPhone Mirroring, and this year's adaptivity story shows up on a single screen. The SwiftUI parts flow into the extra space like they were always meant to. The views we hand-laid years ago for a fixed iPhone width do not — they hug a corner or stretch where they shouldn't.

WWDC 2026 moved the unit of UI design off the device and onto the range. We no longer design for an iPhone and then patch the iPad; we design for a continuum of sizes and aspect ratios, and the system resolves the specific point ([Platforms State of the Union, WWDC26](https://developer.apple.com/videos/play/wwdc2026/102)). The interesting part isn't that Apple asked for this. It's how much of it Apple now does for us, and the precise tool it shipped for the part it couldn't.

## What we get for free

A surprising amount of adaptivity now arrives without per-screen work, as long as the app is built declaratively. Rebuild with the latest SDK and an iOS app is opted into resizing on iPad and through iPhone Mirroring; if it already leans on SwiftUI, Auto Layout, or size classes, it's most of the way there. [Liquid Glass](https://developer.apple.com/documentation/technologyoverviews/liquid-glass) goes further — apps already using it pick up this year's refinements when they run on the new releases, without a recompile, and the material adapts to reduced-transparency and increased-contrast settings on its own.

Toolbars are the neat case, because they used to be the brittle one. Rather than lay a bar out for a known width, we tag each item with how much it matters and let SwiftUI resolve the rest:

```swift
.toolbar {
    // Highest priority: stays visible longest as the window narrows.
    ToolbarItem(placement: .primaryAction) { ShareButton() }
        .visibilityPriority(.high)

    // Lower-priority actions collapse into the overflow menu first.
    ToolbarItem { ArchiveButton() }
    ToolbarItem { DeleteButton() }

    // Pinned to the trailing edge no matter how the bar reflows.
    ToolbarItem(placement: .topBarPinnedTrailing) { AccountButton() }
}
```

As the window narrows, high-priority items stay, quieter ones fold into an overflow menu, and a `topBarPinnedTrailing` placement keeps a chosen item anchored no matter how the bar reflows ([What's new in SwiftUI, WWDC26](https://developer.apple.com/videos/play/wwdc2026/269); [ToolbarItemVisibilityPriority](https://developer.apple.com/documentation/swiftui/toolbaritemvisibilitypriority)). We described importance; SwiftUI handled the instance.

## The code the defaults can't reach

Here's where "free" runs out. Custom views, fixed frames, and device-specific layout math don't adapt themselves, and that's precisely the code that accumulates in an app that's been shipping for years. A design default alone would have dropped that migration in our lap.

So Apple shipped a tool aimed straight at it: a skill for coding agents that finds and fixes common resizability issues, delivered through the same plugin-and-skill mechanism behind the rest of Xcode 27 ([Xcode, agents, and you, WWDC26](https://developer.apple.com/videos/play/wwdc2026/259)). The division of labour is clean. The design system handles the code that's already flexible; the agent skill handles the code that isn't. (It's the same plugin-and-skill machinery we lean on across the editor — [the agent abstraction post](/posts/dynamic-profiles-xcode-agents/) traces where those skills come from.)

## Proving it actually holds

Adaptivity is miserable to verify by hand, because the failures hide at sizes we never open on purpose. This is the quiet win in Xcode 27: agents check visual changes across Previews variants — light and dark, orientations, text sizes, localizations — and can drive the app in the simulator to exercise real layouts. The defaults remove most of the work, the skill retrofits the rest, and the variant checks confirm the result across the whole range instead of the one device on our desk.

## Build for the continuum

The mindset shift underneath all of this is giving up the canonical case. There's no "real" layout to perfect and then special-case around; there's a range, and our job is to declare intent — relative priority, flexible constraints, adopted materials — and trust a resolver to place the points. We make the same move when we let App Intents surface our app [through the system rather than a fixed screen](/posts/app-intents-on-screen-awareness/): describe the capability, let the system decide how it's reached.

So adopt the declarative defaults, point the resizability skill at the views that resist them, and let the agent's variant checks stand in for the devices we don't own. Once the device stops being the unit, designing for the continuum stops feeling like extra work and starts feeling like what it now is — the path of least resistance. Thanks for reading!
