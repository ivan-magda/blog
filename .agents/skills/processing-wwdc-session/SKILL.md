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
6. **Write `digest.md`** — comprehensive single-file synthesis: frontmatter listing
   sources, TL;DR, sections following the chapters, all code blocks, an Open Questions
   section, and blog angles. Leave `[shot: HH.MM.SS]` references out until Phase B (or
   add them only if screenshots already exist).
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
3. **Fold back into `digest.md`** — add `[shot: HH.MM.SS]` references at the relevant
   points (the `HH.MM.SS` is the time in the screenshot's filename, used as a stable
   handle to the file — it is NOT the video timecode). Add genuinely new facts, and
   **flag discrepancies** where a slide contradicts the transcript/Code tab. Add any
   slide-only code to `code.md` with a `// from screenshots/…` note. Update the README
   row if its screenshot/digest columns change.

## Quick reference

| Need | Tool |
|------|------|
| Transcript | `mcp__sosumi__fetchAppleVideoTranscript` (path `/videos/play/wwdcYYYY/NNN`) |
| Summary + Code tabs | Playwright `browser_navigate` + `browser_evaluate` on `.supplement.summary` / `.supplement.sample-code pre` |
| Compress slides | `.agents/skills/processing-wwdc-session/compress-screenshots.sh <session-dir>/screenshots` (pngquant + ImageMagick, ≤200 KB, PNG kept) |
| Tracker | `workspace/wwdc26/README.md` |

Per-session files: `transcript.md`, `meta.md`, `code.md`, `notes.md`, `digest.md`, `screenshots/`.

## Common mistakes

- **Skipping screenshot compression** — raw Retina captures are ~2.5 MB each. Always run the script; preserve PNG.
- **Renaming screenshots** — the `[shot: HH.MM.SS]` handle is the filename's time. Renaming breaks every reference. Keep the originals.
- **Not updating the digest after reading screenshots** — Phase B exists to enrich the digest; reading the images without folding new facts (and discrepancies) back in defeats the point.
- **Treating `[shot:]` as a video timecode** — it is the screenshot filename's clock time, just a file handle.
- **Touching shippable files** — `workspace/` is gitignored scratch. No `llms.txt`, `src/data/blog/`, or `src/assets/` edits when processing a session.
- **Trusting WebFetch for the Summary/Code tabs** — they are JS-rendered; use Playwright.
- **Leaving `// Copy Code` placeholder text** in `code.md` from the `pre` extraction.

## Verification

- Folder has `transcript.md`, `meta.md`, `code.md`, `notes.md`, `digest.md`.
- Every screenshot is valid PNG and ≤200 KB (`find screenshots -name '*.png' -size +204800c` returns nothing).
- Screenshot filenames unchanged; each `[shot:]` in `digest.md` resolves to a real file.
- `digest.md` reflects slide-only facts and flags any slide↔transcript discrepancies.
- `README.md` tracker row is current.
