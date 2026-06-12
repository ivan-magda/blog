# WWDC26 Foundation Models blog cluster — design

**Date:** 2026-06-12
**Status:** Approved (structure, first topic, and coverage model confirmed by Ivan)
**Source material:** `workspace/wwdc26/*/digest.md` (11 sessions, each with transcript/meta/code alongside)

## Goal

Turn the 11 processed WWDC26 Foundation Models sessions into a blog cluster for ivanmagda.dev that (a) captures WWDC-week attention with one fast overview post, (b) builds durable long-tail search traffic with focused deep dives, and (c) leverages the blog's existing agent-building series (s00–s08) as a differentiator no recap site has.

## Coverage model

**Core 3 now, phase 2 by trigger.** Commit only to the three core posts. The hub is a *living index*: every later post gets linked from it and its relevant section refreshed (set `modDatetime` on update). Phase-2 posts are green-lit by external triggers, not dates, and only written from hands-on experience.

Rationale (decided after weighing 3 vs. 6 posts): WWDC recaps die in weeks while practical deep dives earn search traffic for a year; a solo blog should never announce more than it can sustainably ship; iOS 27 GM (~September 2026) brings a second, less crowded search wave from developers actually adopting the APIs — the natural home for phase 2.

## Core posts

### Post 1 — Hub (target: 2026-06-13/14)

- **Working title:** "Foundation Models, Year Two: From On-Device API to General LLM Runtime"
- **Primary sources:** 241 digest; light pulls from 319, 242, 339, 334, 246, 237.
- **Thesis:** last year Foundation Models was a Swift API to one small on-device model. This year it's three things: a general Swift LLM client (any model, anywhere, incl. Linux), a server model with zero key management (PCC), and the beginnings of an agent runtime (Dynamic Profiles, system tools, local RAG).
- **Outline:**
  1. Lede — the reframe in two paragraphs, not a feature list.
  2. The models — rebuilt on-device model (vision input, context-size/token-count APIs), then PCC as the headline (one-line switch, 32K context, reasoning, no auth/keys/developer cost, daily user quota). Links to Post 2.
  3. The abstraction layer — `LanguageModel` protocol, CoreAI/MLX open-source implementations, Anthropic & Google first-party Swift packages, `usage` property. Ecosystem-signal argument.
  4. Agent primitives — Dynamic Profiles (~4 paragraphs, simplest `CraftProfile` snippet) + system tools (Spotlight RAG, BarcodeReader/OCR). Links to Post 3.
  5. Tooling round-up — Instruments template, Evaluations in one "decide by data, not vibes" paragraph, `fm` CLI (`serve` is the underrated bit), Python SDK, utilities package as a release-cadence signal.
  6. What to do now — apply for the PCC entitlement, grab the Origami sample, watch the utilities repo.
- **Length:** ~2,000 words. **Tags:** `wwdc`, `foundation-models`, `apple-intelligence`, `swift`, `ai-agents`.
- **Living-index behavior:** when any later cluster post ships, add the link here, refresh that section, bump `modDatetime`.

### Post 2 — PCC deep dive (target: week of 2026-06-15)

- **Working title:** "A Server LLM With No API Keys: Private Cloud Compute in the Foundation Models Framework"
- **Primary sources:** 319 digest + 241 §3; the released Apple article *Adding server-side intelligence with Private Cloud Compute* wins over slides where they disagree.
- **Spine:** one-line switch → on-device vs PCC trade-off table (quotable; docs article carries it verbatim) → reasoning levels and their real cost (46-in/1,238-out/9.6s demo; reasoning text consumes the 32K window; observe the transcript for progress UI) → **quota UX done right** (centerpiece: persistent UI not alerts; `belowLimit`/`isLimitReached`/`limitIncreaseSuggestion`/`resetDate`; the five Xcode simulated-availability states) → ship `model.availability` (enum), not the slide's `isAvailable` Bool; OS 27 floor; network-failure → on-device fallback → entitlement (`com.apple.developer.private-cloud-compute`) + <2M downloads eligibility → one paragraph on "decide by data, not vibes" (Evaluations pointer).

### Post 3 — Dynamic Profiles deep dive (target: week of 2026-06-22)

- **Working title:** "An Agent Framework Hiding Inside a Session: Dynamic Profiles in Foundation Models"
- **Primary sources:** 242 digest + 241 §6; Apple docs article *Composing dynamic sessions with instructions and profiles*.
- **Spine:** last year's manual boilerplate (`withObservationTracking` + `dropFirstInstructions`) vs the declarative `body` → profiles/instructions/modifiers, per-phase models → history transforms, lifecycle hooks, session properties → **baton-pass vs phone-a-friend with two sequence diagrams** → required-tool-calling while-loop footgun + `FinalAnswerTool` → the cost of rewriting history (KV cache + model confusion; "training wheels off") → mapping table to the agent series (phone-a-friend ≈ s04 subagents, Skills API ≈ s05 skill loading, summarize-and-drop ≈ s06 context compaction, required mode ≈ s01 agent loop) → when you'd still reach for a real agent framework.
- **Internal links:** s01, s04, s05, s06 posts. Do **not** link to the unlisted synth posts (linking from a listed post would surface them); `synth-dynamic-profiles-xcode-agents` stays as-is and this post must not reuse its app+Xcode pairing angle.

## Phase 2 (triggered, not scheduled)

| Post | Trigger | Scope sketch |
|---|---|---|
| Spotlight local RAG | iOS 27 GM window (~Sept 2026) and/or having built something real with `SpotlightSearchTool` | 246 digest: "local RAG without the plumbing", guidance profiles, pipeline stages, `searchableItems(forIdentifiers:)` rehydration gotcha |
| Debug & measure combo | iOS 27 GM + hands-on Instruments/Evaluations experience on a real feature | 243 digest (silent-failure walkthrough, TTFT/tokens-sec/latency) + a slim Evaluations primer from 298. One post, not three; only if there's a genuine opinion to share |
| Provider protocol | The day Anthropic/Google Swift packages ship | 339 digest: four steps, executor-store design, streaming handshake, auth/App Attest |

Each phase-2 post, when shipped: add to hub index + `llms.txt`.

## Explicitly out of scope

- Standalone deep eval posts (335, 299 territory) — lowest author interest; essentials folded into Post 2 and the phase-2 combo.
- Standalone image-understanding post (237) — half is Vision framework, not FM; the FM-relevant bits (image input, built-in tools, `ImageReference`) live inside the hub and Post 3.
- `fm` CLI/Python standalone (334) — optional bonus, not committed; hub covers it in one paragraph.

## Cross-cutting requirements

**Verify before publishing** (open questions flagged in digests; check against Apple docs via sosumi/WebFetch, prefer released docs over slides):

- Hub: open-source status precision ("being released" vs already on GitHub — verify repo/license before asserting); `apple_fm_sdk` PyPI name; shipped `fm` command set; don't repeat the speaker's "2027 release" slip.
- Post 2: on-device `contextSize` (4096 vs 8192 on 27.0); exact daily quota numbers (likely unpublished — phrase around it); "2M downloads" metric definition; reasoning levels (`.light`/`.moderate`/`.deep` confirmed by docs article); quota check order (`isLimitReached` first, per article).
- Post 3: lifecycle hook signatures against the docs article; don't present sample tool names as canonical API (slides are inconsistent); `.rollingWindow` API shape; mark utilities-package types as Beta; confirm `apple/foundation-models-utilities` repo link.

**Publishing checklist (every post):** frontmatter complete (`title`, `description`, `slug`, `pubDatetime`, `tags`; no empty strings; `draft: false` when shipping); post body headings `##` or smaller; update `public/llms.txt`; run the `reviewing-blog-draft` skill before publish; voice matched to the existing human-written posts (s0X series), not the synth posts.

## Open follow-ups

- After the core 3 ship: review traffic/queries before green-lighting any phase-2 post.
- At iOS 27 GM: re-verify all quoted APIs in published posts against the GM SDK; refresh hub.
