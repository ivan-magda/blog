---
name: processing-wwdc-session
description: Use when the user drops an Apple Developer session video URL (developer.apple.com/videos/play/...) to research into the blog's workspace, or adds a screenshots/ folder to an already-processed session dir. Builds workspace/wwdcNN/{num}-{slug}/ with transcript, code, meta, notes, and a synthesized digest; compresses slide screenshots and folds their info back into the digest.
---

# Processing a WWDC Session

## Overview

Turns an Apple Developer video URL into a research folder under the gitignored
`workspace/` so a later session can draft blog posts from one synthesized file
(`digest.md`). Two phases: **A. Fetch & build** runs the moment a URL is dropped.
**B. Screenshots** runs later, when the user adds `screenshots/` — slides are not
available at fetch time, so the digest is written first and enriched afterward.

`workspace/` is gitignored: this produces **zero shippable changes**. Do NOT touch
`src/data/blog/`, `public/llms.txt`, `src/assets/`, or any SEO file — those are for
*published* posts only.

## Model policy — the digest must be Opus

Fetching, scraping, and file scaffolding (Phase A steps 1–5, Phase B steps 1–2) are
mechanical and fine on any model — run the whole skill on Sonnet if you like.
**`digest.md` is the one high-judgment synthesis step and MUST be produced on Opus.**

- If you (the orchestrator) are **not** running on Opus, **spawn a subagent with the
  Opus model** to do it (Agent/Task tool, `model: opus`). Give it the session dir; it
  reads `transcript.md`, `meta.md`, `code.md` (plus `screenshots/` in Phase B) and
  writes/updates `digest.md`.
- If you are **already on Opus**, write/update the digest directly.
- **Never** create or update the digest on a smaller model.

This applies to BOTH the initial write (Phase A step 6) and the screenshot enrichment
(Phase B step 3).

## Phase A — Fetch & build the entry

Trigger: a `developer.apple.com/videos/play/wwdcYYYY/NNN` URL.

1. **Derive paths.** Collection dir is `workspace/wwdc26/` (this blog's WWDC 2026 set).
   Session number `NNN` from the URL; slug = short kebab of the title (e.g.
   `241-foundation-models`). Create `workspace/wwdc26/{NNN}-{slug}/`.
2. **Transcript.** `ToolSearch` → `select:mcp__sosumi__fetchAppleVideoTranscript`, call
   it with `path: /videos/play/wwdcYYYY/NNN`. Write `transcript.md` with YAML
   frontmatter (`title, source, session, collection, duration, fetched, via: sosumi.ai`)
   — raw Apple words, attribution intact.
3. **Summary + Code tabs.** These are JS-rendered tabs, not in the transcript and not
   reachable by WebFetch. Use Playwright: `ToolSearch` →
   `select:mcp__plugin_playwright_playwright__browser_navigate,mcp__plugin_playwright_playwright__browser_evaluate`.
   `browser_navigate` to the URL, then ONE `browser_evaluate` reading both (all tabs
   live in the DOM — no clicking):
   - Summary: `document.querySelector('.supplement.summary')?.innerText`
   - Code: `Array.from(document.querySelectorAll('.supplement.sample-code pre')).map(p => p.innerText)`
4. **Write `meta.md`** — description, key topics, chapter summary (from the Summary
   tab), a "Related sessions to fetch" checklist (talks named in this one), pointer to
   `code.md`. **Write `code.md`** — each snippet under a `## HH:MM — label` heading in a
   fenced block. Clean any `// Copy Code` / `// Insert code snippet` placeholder text
   that bleeds into the extraction.
5. **Write `notes.md`** — a stub for the user's own analysis (blog angles, open
   questions, code to reproduce). Keep separate from `transcript.md` so drafts pull
   from the user's words, not Apple's.
6. **Write `digest.md` (Opus only — see Model policy)** — comprehensive single-file
   synthesis: frontmatter listing sources, TL;DR, sections following the chapters, all
   code blocks, an Open Questions section, and blog angles. Leave `[shot: HH.MM.SS]`
   references out until Phase B (or add them only if screenshots already exist). If you
   are not on Opus, spawn an Opus subagent to read steps 1–5's files and write this.
7. **Update `workspace/wwdc26/README.md`** — add the session's tracker row.

If the target folder already exists, confirm before overwriting.

## Phase B — Screenshots post-completion step

Trigger: a `screenshots/` folder appears in an existing session dir (the user took
slide captures and dropped them in).

1. **Compress in place** — run, from the repo root:
   `.agents/skills/processing-wwdc-session/compress-screenshots.sh <session-dir>/screenshots`
   (the script is bundled with this skill). It
   downscales + palette-quantizes each PNG to ≤200 KB (band 100–200 KB), preserving
   PNG format. **Keep the original `Screenshot … HH.MM.SS.png` filenames** — do NOT
   rename, do NOT make `.webp` siblings, do NOT move into `src/assets`.
2. **Read every screenshot** (the Read tool renders images). Extract what the
   transcript and Code tab do NOT capture: diagram structure, on-screen API values,
   demo token counts/durations, the CLI surface, and any code visible on a slide that
   is missing from `code.md`.
3. **Fold back into `digest.md` (Opus only — see Model policy)** — add
   `[shot: HH.MM.SS]` references at the relevant points (the `HH.MM.SS` is the time in
   the screenshot's filename, used as a stable handle to the file — it is NOT the video
   timecode). Add genuinely new facts, and **flag discrepancies** where a slide
   contradicts the transcript/Code tab. Add any slide-only code to `code.md` with a
   `// from screenshots/…` note. Update the README row if its screenshot/digest columns
   change. If you are not on Opus, spawn an Opus subagent that reads the screenshots and
   rewrites the affected digest sections.

## Bulk mode — many sessions at once (parallel subagents)

When a whole catalog is dropped (dozens of URLs), do NOT run Phase A serially per
session. Split the work so the one shared resource (the Playwright browser) never
races and the 20–60 KB transcripts stay OUT of the orchestrator's context:

1. **Build a manifest first.** Parse the link list into `{num, title, url, folder}`
   (clean, stopword-stripped slugs) and create all folders. Always dispatch using the
   manifest's folder names — hand-typed slugs drift from the created dirs and make the
   `browser_evaluate` `filename` write fail with ENOENT.
2. **One fetcher subagent at a time** (serial, OWNS the browser): for each session
   `browser_navigate` + ONE `browser_evaluate` that saves Summary/Code to
   `<folder>/_supplement.json` via the `filename` argument (keeps the payload out of
   your context). Batches of ~16. **Never run two fetchers at once** — the single
   browser instance will race and cross-contaminate pages.
3. **Parallel synthesis subagents (Opus — see Model policy)** — one per session, waves
   of ~8. Each fetches its OWN sosumi transcript, reads `_supplement.json`, and writes
   all five files. They use sosumi + file tools ONLY (no browser), so a synthesis wave
   can run concurrently with the NEXT fetcher batch running in the background.
4. **Normalize after each fetch batch.** `browser_evaluate` saves its result
   double-JSON-encoded (a JSON string wrapping the object) — decode twice
   (`json.loads(json.loads(...))`) once so synthesis reads clean JSON.
5. **Sync trackers from disk, don't hand-maintain.** A script that scans folders
   (digest present? supplement summary/code non-empty?) idempotently regenerates the
   README table and the link-list ✅ markers — survives context summarization.
6. **Labs / keynotes have no transcript.** Group labs and some keynotes return
   "Transcript not found" from sosumi and have no Summary/Code tab — write the stub
   (`_No transcript available._`, minimal meta/digest, Transcript `n/a`).

Give each synthesis subagent a one-line dispatch pointing at a shared instruction file
plus `NUM/TITLE/URL/FOLDER`, so prompts stay tiny and consistent across the fleet.
Overlap rule: synthesis (sosumi) + the next fetcher (browser) may run concurrently;
two browser users may not.

## Quick reference

| Need | Tool |
|------|------|
| Transcript | `mcp__sosumi__fetchAppleVideoTranscript` (path `/videos/play/wwdcYYYY/NNN`) |
| Summary + Code tabs | Playwright `browser_navigate` + `browser_evaluate` on `.supplement.summary` / `.supplement.sample-code pre` |
| Bulk fetch | ONE serial fetcher subagent (browser) → `_supplement.json` via `filename`; synthesis in parallel Opus subagents (sosumi only) |
| Compress slides | `.agents/skills/processing-wwdc-session/compress-screenshots.sh <session-dir>/screenshots` (pngquant + ImageMagick, ≤200 KB, PNG kept) |
| Write/update digest | **Opus only** — if orchestrator isn't on Opus, spawn an Opus subagent (Agent/Task `model: opus`) |
| Tracker | `workspace/wwdc26/README.md` |

Per-session files: `transcript.md`, `meta.md`, `code.md`, `notes.md`, `digest.md`, `screenshots/`.

## Common mistakes

- **Producing or updating the digest on a smaller model** — the digest is the deliverable and the only real synthesis step; it must be Opus. Steps 1–5 (and screenshot compression) can be any model. If you're on Sonnet, spawn an Opus subagent for the digest — don't write it yourself.
- **Skipping screenshot compression** — raw Retina captures are ~2.5 MB each. Always run the script; preserve PNG.
- **Renaming screenshots** — the `[shot: HH.MM.SS]` handle is the filename's time. Renaming breaks every reference. Keep the originals.
- **Not updating the digest after reading screenshots** — Phase B exists to enrich the digest; reading the images without folding new facts (and discrepancies) back in defeats the point.
- **Treating `[shot:]` as a video timecode** — it is the screenshot filename's clock time, just a file handle.
- **Touching shippable files** — `workspace/` is gitignored scratch. No `llms.txt`, `src/data/blog/`, or `src/assets/` edits when processing a session.
- **Trusting WebFetch for the Summary/Code tabs** — they are JS-rendered; use Playwright.
- **Leaving `// Copy Code` placeholder text** in `code.md` from the `pre` extraction.
- **(Bulk) Running two browser fetchers at once** — the Playwright instance is shared and single; concurrent navigations race. Exactly one fetcher; parallelize only the sosumi synthesis.
- **(Bulk) Hand-typing folder slugs per dispatch** — they drift from the created dirs and the `filename` write fails (ENOENT), silently dropping that supplement. Always read folders from the manifest.
- **(Bulk) Forgetting the double-encode** — `browser_evaluate`'s saved `_supplement.json` is a JSON string wrapping the object; parse twice or synthesis sees a string, not `{summary, code}`.

## Verification

- Folder has `transcript.md`, `meta.md`, `code.md`, `notes.md`, `digest.md`.
- Every screenshot is valid PNG and ≤200 KB (`find screenshots -name '*.png' -size +204800c` returns nothing).
- Screenshot filenames unchanged; each `[shot:]` in `digest.md` resolves to a real file.
- `digest.md` reflects slide-only facts and flags any slide↔transcript discrepancies.
- `README.md` tracker row is current.
