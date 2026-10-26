# Content and research

Reviewed on 2026-10-05. Public content and versioned workflows are authoritative;
private research availability can differ between checkouts.

## Writing pipeline

Use the [writing skill](../skills/writing-blog-post/SKILL.md) and its saved
[research](../../.claude/workflows/post-research.js) and
[drafting](../../.claude/workflows/post-draft.js) workflows. The skill owns the
outline checkpoint, draft handoff, frontmatter rules, and quality gates. Invoke
workflows by `scriptPath`, with `args` as an object, as documented there. Run
artifacts belong in ignored `workspace/posts/<slug>/`. The final editor remains
the author; a generated draft is not permission to publish it. Past comparison
scores and one-time verification claims were not retained as reusable facts.

## Synthesis posts

The current content directory contains eight `synth-` posts with `draft: false`
and `hideFromFeed: true`; old unmerged-branch descriptions are superseded. Keep the
`synth-` filename label but omit it from the public slug. Review citations and
cross-links, update `public/llms.txt`, and copy only specifically intended generated
files so previous edited posts are not overwritten.

The hiding contract is documented in [root guidance](../../CLAUDE.md): inspect
[postFilter](../../src/utils/postFilter.ts), archives, and Pagefind markup together.
These posts remain built and indexable while excluded from ordinary reader feeds.
Use human-written posts for voice examples; review generated prose independently
and vary repetitive openings. Content quality and citation accuracy need review;
old content ratios are not current SEO evidence.

## Foundation Models cluster

The current content includes the
[overview](../../src/data/blog/wwdc26-foundation-models-year-two.md),
[Private Cloud Compute deep dive](../../src/data/blog/foundation-models-private-cloud-compute.md),
and [Dynamic Profiles deep dive](../../src/data/blog/foundation-models-dynamic-profiles.md).
Treat the overview as a living index: when a later cluster article ships, add its
link, update the relevant section, and set `modDatetime`. Preserve the preference
not to add links from these listed posts to hidden synthesis posts.

When available, consult the local, ignored
`docs/superpowers/specs/2026-06-12-wwdc26-foundation-models-cluster-design.md` before
editing the cluster. It records beta-era verification and follow-up requirements;
reverify quoted APIs against the current released SDK and primary documentation.
Spotlight/RAG and debug/measurement topics were conditional on hands-on experience
and release readiness, not commitments to publish on a past date.

The provider article named in old memory is absent from `src/data/blog/` in this
checkout. Its local `workspace/posts/foundation-models-bring-your-own-llm/` contains
pipeline draft and handoff artifacts. Inspect those and ask for the intended
editorial scope before resuming; do not assume an uncommitted publishable draft,
old branch status, or live publication.

## Optional local research routes

- English article prepared on 2026-10-14 for ivanmagda.dev:
  [Swift debounce investigation](../../src/data/blog/swift-debounce-runtime-investigation.md).
  The author approved a chronological investigation through sequential hypotheses,
  prioritizing non-obvious research without a fixed word limit and plentiful
  diagrams, plots, and real code. On 2026-10-18 the author confirmed publication;
  the current source has `draft: false`. The optional ignored `workspace/posts/swift-debounce-runtime-investigation/`
  contains direction, evidence, independent English variants, verification, and
  handoff records. Package excerpts are frozen at revision
  `990cf04587cf922748c13876d2843071c22873fa`; preserve the distinction between
  historical prototypes, current package comparisons, and simplified storage
  experiments. The headline's 50× concerns synchronous send cost in one workload,
  not callback or application speed. Raw implementation transcripts remain private.
  Destination and article-language intake now lives in the writing skill; reuse
  the explicit ivanmagda.dev/English decision for this article.

- Russian Habr adaptation of the Swift debounce investigation prepared on
  2026-10-18, awaiting author review and publication. Optional ignored
  `workspace/posts/swift-debounce-habr/README.md` routes the editable draft,
  13 Russian figures, independent Codex/ChatGPT web variants, selective synthesis
  and fresh web reader review. The author requested the in-app browser for this
  work. Habr uploads and editor preview remain pending; no blog changes made.

- Swift synchronization benchmarks on iOS (`Mutex`, `OSAllocatedUnfairLock`,
  actors, locks, queues, atomics), saved 2026-10-13; research phase since
  2026-10-19. The optional ignored `workspace/posts/swift-synchronization-benchmarks/`
  holds the README (goal, angle, workloads), `deep-research-requests.md` (status
  and run order), prompts in `requests/` and reports in `research/`. As of
  2026-10-20 all three waves (A–L) are done and cross-checked; next is the harness.
  Report claims marked UNVERIFIED stay unverified. No harness, draft or date yet.

- Published Habr adaptation: Ivan published
  [Общая память проекта для Claude Code и Codex](https://habr.com/ru/articles/1091422/)
  on 2026-10-07. Preparation and publication notes are in the optional ignored
  `workspace/posts/project-memory-habr/README.md`. The published text includes
  additional author edits; consult it before reusing the local preparation copy.

- WWDC source processing: the
  [processing skill](../skills/processing-wwdc-session/SKILL.md) documents the
  transcript, screenshot, and digest workflow. Check ignored
  `workspace/wwdc26/README.md` and `_tools/` before reprocessing material. For local
  whisper transcripts, follow its VAD, `-mc 0`, loop-gate, and no-invented-speakers
  requirements. Old completed-session counts and a separate mirror's publish gaps
  were not verified and do not establish current sync status.
- Habr follow-ups: `docs/research/habr-publishing-playbook.md` is an optional local
  reference. The prior submission was maintained in another project; moderation
  status and submission details are private historical records, not current blog
  state. Reconfirm them in the owning project if the author requests follow-up.

Keep research transcripts, private tool locations, external account details, and
launch drafts in their existing ignored locations or the protected archive.
