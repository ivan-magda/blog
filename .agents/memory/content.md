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
  2026-10-20 all three waves (A–L) are done and cross-checked.
  On 2026-10-29 a probe app proved that a free Personal Team (no paid account) can
  build, install, launch and copy results on a physical iPhone; details in
  `research/local-checks-2026-10-29.md`. Report claims marked UNVERIFIED stay
  unverified. On 2026-11-04 Ivan chose a Russian Habr original first and an
  English adaptation later; see the README's decisions and milestones. On
  2026-11-05 he approved the harness design (`harness-design.md` in that folder);
  the harness lives in a separate repository,
  `~/Developer/swift-synchronization-benchmarks` (created 2026-11-05), whose
  `docs/` holds the living design copy, the experiment specs, the build plans and
  the device acceptance records. Build parts 1 and 2 of 3 (core, calibration,
  base comparison, Mac script; async code, priority inversion) passed acceptance
  on both iPhones on 2026-11-05; on 2026-11-06 experiments 1, 7 and 8B were
  restructured for reading, and part 3 (experiments 2, 3, 4, 8A, 9) passed
  acceptance, which completes the harness build (milestone 7). Continue from
  the study folder's `handoff-2026-11-06.md`. Later on 2026-11-06, milestone 8
  completed: settings confirmed, reboot checked and strict calibration accepted
  on both phones (`research/phone-preparation-2026-11-06.md`). Pilot measurements were recorded on 2026-11-07;
  milestone 9 completed after a user-requested cooler-windowsill repeat on iPhone 11
  passed with 30-second pauses and recorded 45% brightness (12/12, 12.42 minutes).
  Keep the recorded conditions and bounded-validation limits; next is main runs.
  In a later follow-up Ivan approved 0% brightness for future iPhone 11 measurements;
  the windowsill/0%-brightness/5-second-pause follow-up passed 24/24 over 16.32 minutes.
  Use that latest iPhone 11 condition in main planning. Ivan subsequently chose
  5 seconds for iPhone 15 too and explicitly specified windowsill/0% brightness
  for both phones. A later all-family pacing check passed 13/13 on each phone,
  including consecutive 8B launches. Main plans now use 5-second host pauses
  everywhere; 8B keeps its 700 ms internal trial pause. Retain historical condition
  distinctions and strict thermal gates (see handoff).
  Continue from `handoff-2026-11-07.md` and `pilot-conclusions-2026-11-07.md` in
  the study folder. The runner fractional-timeout fix is now committed in the harness;
  the pilot recorded 171 passing Python tests. The handoff's "Milestone 10" section
  gives the next steps: executable plans, timing/night schedule, agreement on proposed
  repetitions/statistics, phone preparation and main runs. No device run is queued.
  Retain manual unlock after reboot. No draft or date yet. Ivan wants
  readable code there: descriptive names (no experiment numbers such as `Exp1`
  in code or data; numbers stay only in docs) and normally formatted listings.
  He also asked for a pragmatic process: no extra structure where it adds nothing.

  Update 2026-11-08: milestone 10 is complete; milestone 11 is now in progress.
  Use the study README and `handoff-2026-11-08.md` instead of the older next-step
  instructions above. Ivan wants analysis one experiment at a time, starting with
  experiment 1, with findings explained before chart design. Show one phone in
  the main explanation; preserve the second phone and material differences in
  supporting analysis. Current conclusions, terminology corrections, prior-art
  framing and open decisions live in the study's
  `analysis-2026-11-08/experiment-1-conclusions.ru.md`; keep that file updated
  rather than leaving conclusions only in chat. Other generated analyses and
  the initial charts remain preliminary. Ivan subsequently chose one article
  on 2026-11-08; the earlier undecided-format status is superseded.

  Later on 2026-11-08, Ivan explicitly authorized parallel subagent analysis of
  all remaining experiments and asked for the full chat history in their context.
  This supersedes sequential execution of the analysis, while retaining separate
  plain-language explanations per experiment and one phone in the main tables.
  The study's `analysis-2026-11-08/parallel-analysis-brief.md` records the common
  requirements; no further measurements or chart work follow from this request.
  Those seven reports are now prepared and checked. Continue from the study's
  `analysis-2026-11-08/README.md`: each experiment has Russian working conclusions,
  English technical evidence and independent calculations. Keep author discussion
  separate from report preparation; charts and selection of publication results
  are still open. Publication format is one article (Ivan, 2026-11-08), followed
  by the already planned English adaptation.
  The study's `analysis-2026-11-08/overall-conclusions.ru.md` now synthesizes all
  experiments after full reading of the sixteen current reports, with the overall
  answer first and per-experiment findings afterward. Ivan explicitly requires
  reading complete reports before making an overall research conclusion.
  Public-repository follow-up on 2026-11-08: source is now public ahead of the
  article. English result summaries were prepared locally in the harness root
  README, eight experiment READMEs and `docs/results.md`, then committed and
  pushed at Ivan's request (`1d64013`, `1f0dcba`). The raw-data release is now
  published; its English description was updated and verified without changing
  assets or publication flags. Use the study's
  `analysis-2026-11-08/github-readme-update.md` for validation and publication
  status rather than the earlier promise to publish source only with the article.

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
