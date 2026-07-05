---
name: writing-blog-post
description: Use when Ivan gives a post topic, idea, or rough draft to turn into a blog post — orchestrates the content-generation pipeline (research → outline checkpoint → parallel variants → merge → quality gates) via the post-research and post-draft saved workflows, ending with a draft in src/data/blog/ plus a handoff report. Not for synth SEO posts and not a replacement for the reviewing-blog-draft pre-publish review.
---

# Writing a Blog Post (content-generation pipeline)

## Overview

Turns a topic sentence or a rough draft into a final, editable post in the house voice with exactly one human checkpoint (outline). Design rationale and evidence: `docs/superpowers/specs/2026-07-05-blog-content-pipeline-design.md` and `docs/research/llm-writing-pipeline-research.md`. Voice source of truth is `docs/blog-project-knowledge.md` — point agents at it; this skill duplicates none of its rules. The workflow prompts deliberately prime a few high-violation rules at generation time (per the design spec); do not strip that priming, and never add rules to prompts that aren't in the doc.

**Ivan is the final editor.** The pipeline targets an excellent editable draft, not unreviewed publishing. His phrasings from a provided draft are preserved; content cuts and personality calls are his.

## Process

### 1. Gather input

From Ivan's message: a topic OR a path to his rough draft, plus optional materials (WWDC digests in `workspace/`, a repo+tag, research docs). Ask only for what's missing to start — nothing else.

### 2. Run the research workflow

```
Workflow({ scriptPath: "/Users/jetbrains/Developer/blog/.claude/workflows/post-research.js", args: {
  topic: "...",            // or draftPath: "src/data/blog/... / any path"
  materials: ["workspace/wwdc26/241-.../digest.md", ...],  // optional, absolute paths
} })
```

Invoke by `scriptPath`, not `name` — name resolution can serve a stale snapshot after the script was edited. Pass `args` as a real JSON object, not a string (the scripts tolerate a string, but don't rely on it).

It writes `workspace/posts/<slug>/research-packet.md` and `outlines.md`, and returns 2–3 outline candidates with a recommendation.

### 3. Checkpoint (the only one)

Present the outline candidates to Ivan via AskUserQuestion: recommended first, each with thesis + heading arc + rough length. Capture his pick and any edits/constraints. If the confirmed slug differs from the working slug post-research used, rename the run directory first: `mv workspace/posts/<working-slug> workspace/posts/<confirmed-slug>` — post-draft resolves every path (research packet included) from the confirmed slug. Then write `workspace/posts/<slug>/direction.md`:

```markdown
# Direction: <working title>
- Slug: <confirmed slug>
- Template: series-style | standalone   (per blog-project-knowledge.md §3)
- Thesis: <one sentence>
- Target length: <words>
- Exemplar posts: <1–2 published src/data/blog/ files matching the template; never synth-*.md — machine-generated, wrong voice>
- Constraints from Ivan: <verbatim>
- Preserved phrasings: <verbatim list, if input was a draft>

## Chosen outline
<full heading arc with per-section notes on what goes in/out>
```

After this point the pipeline runs without questions.

### 4. Run the drafting workflow

```
Workflow({ scriptPath: "/Users/jetbrains/Developer/blog/.claude/workflows/post-draft.js", args: {
  slug: "<confirmed slug from direction.md>",
  pubDatetime: "<current UTC, e.g. 2026-07-05T09:00:00Z>",
} })
```

It produces `workspace/posts/<slug>/final.md` and `handoff.md` (variants → critique → pairwise judging → generative merge → facts/style/mechanics gates; facts and style gates run max 2 rounds then escalate, mechanics is single-pass with escalation). The return value and handoff carry the prepared `llms.txt` entry.

### 5. Finish (main session)

1. Read `handoff.md`. **Surface blockers first** — a killed load-bearing claim stops the flow until Ivan decides.
2. Run the **stop-slop** skill over `final.md` as an explicit pass (house voice wins where they conflict).
3. Copy the result to `src/data/blog/<slug>.md` with `draft: true`. Frontmatter rules: omit `ogImage`/`canonicalURL` entirely (never empty strings), field order matches existing posts, description ≤160 chars ending with a period.
4. Append the prepared entry to `public/llms.txt`.
5. `pnpm run build` — confirm the expected page count indexes.
6. Present the handoff summary: what was verified (with sources), what deserves Ivan's eyes, judge/critique notes. Hand over for his edit. Before publishing, the **reviewing-blog-draft** skill runs as usual.

## Failure handling

- Workflow died mid-run → relaunch with `{scriptPath, resumeFromRunId}`; completed agents replay from cache. Read the run's `journal.jsonl` before diagnosing an empty result.
- Facts gate killed a central claim → do not write around the hole; it's a blocker in `handoff.md`.
- Fewer than 2 usable variants → the merge proceeds with what survived; note it in the handoff.

## Guardrails

- No publishing, pushing, or social copy — out of scope by spec.
- Never rewrite Ivan's preserved phrasings; flag instead of "improving".
- `direction.md` is the contract: scope changes after the checkpoint require a new run, not silent drift.
