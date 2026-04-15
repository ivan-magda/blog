---
name: reviewing-blog-draft
description: Use when a new blog post draft in src/data/blog/ is ready for review before publishing — catches empty-string frontmatter bugs, unshipped draft flags, fabricated citations, heading hierarchy breaks, missing llms.txt updates, and sub-agent overreach
---

# Reviewing Blog Drafts

## Overview

New blog drafts need a structural + factual review pass before publishing. The Zod schema and `pnpm run build` catch type errors. They do not catch empty-string SEO traps, `draft: true` still set at ship time, fabricated/future-dated citations, heading hierarchy slips, or a stale `llms.txt`. This skill is the checklist for that review pass.

## Process

1. **Establish conventions** — read 2–3 existing posts in `src/data/blog/` plus `src/content.config.ts` (Zod schema), `src/layouts/PostDetails.astro`, and `src/layouts/Layout.astro`. Conventions live in the existing posts and layout code, not in docs.
2. **Walk the checklist below**, grouping findings by severity (🔴 critical → 🟡 medium → 🟢 minor).
3. **Present findings first, fix second.** Ask before applying — the author may have intentional deviations.
4. **After fixes, diff the body against the original draft.** Sub-agents silently rewrite prose if delegated to. Restore any unauthorized edits.
5. **Run `pnpm run build`** and confirm the expected page count is indexed.

## 🔴 Critical — will not ship or will ship broken

| Check | Why it breaks |
|-------|--------------|
| `draft: true` still set | Post won't appear on the built site. Flip to `false` before deploy, or confirm intent. Post-deploy "why isn't my post there?" moments usually trace here. |
| `canonicalURL: ""` | Empty string bypasses the destructuring default in `Layout.astro` (defaults only fire on `undefined`). Result: empty `<link rel="canonical">`, empty `og:url`, empty `twitter:url`, empty JSON-LD `@id`. **Remove the field** — Layout self-references automatically from `Astro.url.pathname`. |
| `ogImage: ""` | Same empty-string trap. **Omit** — Satori auto-generates per-post OG images when `SITE.dynamicOgImage` is `true`. |
| Body headings start at `###` | Frontmatter `title` renders as h1, so body must open at `##` (h2). Skipping to `###` breaks heading hierarchy for SEO crawlers and screen readers. |
| Unverifiable or future-dated citations | ArXiv IDs encode `YYMM.NNNNN`. An ID whose `YYMM` is in the future is a tell that the post cites a fabricated source (common when a draft was LLM-assisted). WebFetch every citation and confirm the paper exists and says what the post claims. A single fake citation undermines the whole piece. |
| Unattributed quotes or stats | Any `"quoted phrase"` without a named source, or any specific percentage ("60–80% of tokens") without a link, is a credibility risk. Require a source or reword as the author's own observation. |

## 🟡 Medium

| Check | Fix |
|-------|-----|
| `modDatetime: null` | Omit — existing posts don't include it |
| Frontmatter field order | Match existing posts: `title → author → pubDatetime → slug → featured → draft → tags → description` |
| Description > 160 chars | Google truncates around 155–160; trim while keeping the key message |
| Description punctuation | Existing posts' descriptions all end with a period. Mismatch is a cross-post consistency slip. |
| `public/llms.txt` not updated | Add the post under the matching section (per project `CLAUDE.md` instructions) |

## 🟢 Minor

- **`pubDatetime` in the future**: `src/utils/postFilter.ts` filters posts until publish time (with 15-min `scheduledPostMargin`). Confirm scheduling is intentional, otherwise the post won't appear after deploy. Dates are UTC — convert from author's local time if needed.
- **`featured: true`**: confirm intent. Normally only the series opener is featured.
- **Tags**: new tags auto-create noindexed listing pages. Singleton tags (used on only one post) are fine but create thin pages — consider reusing an existing tag if close enough.
- **External links**: all `https://`, no bare domains or `http://`.
- **Cross-post consistency sniffs**: scan a couple of sibling posts for closing patterns (sign-offs, ending phrases) and title casing. Drift isn't a rule violation but is worth flagging.

## Output Format

Report findings as a severity-grouped list with tables for fast scanning. End with: **"Want me to apply these fixes?"** — don't auto-fix without confirmation.

After fixes, report as a punch list: Issue → Fix → Status.

## Watch for Sub-Agent Overreach

If fixes are delegated to a sub-agent, it may silently:
- Delete phrases from the body ("and only then executed")
- Condense multi-sentence paragraphs into one
- Flip `featured: true` to `false` without being asked

**Always diff the post body against the original draft after sub-agent fixes.** Restore unauthorized edits before reporting done.

## Verification Before Commit

- `pnpm run build` passes, expected page count indexed
- Frontmatter schema-valid, `draft: false`, field order matches convention
- No `###` body headings outside code blocks (grep `^### ` to verify)
- `public/llms.txt` lists the new post
- Every citation WebFetched and confirmed
- Body diff vs. original shows only intended changes

## Common Mistakes

- **Trusting the Zod schema to catch empty strings** — `z.string().optional()` accepts `""`. The destructuring default only fires on `undefined`.
- **Treating factual accuracy as someone else's problem** — fabricated citations ship if not caught here.
- **Using `###` for top-level body headings** — frontmatter `title` is h1.
- **Shipping with `draft: true`** — post silently vanishes from the built site.
- **Skipping the `llms.txt` update** — required by project `CLAUDE.md`, easy to forget.
- **Accepting sub-agent fixes without a body diff** — unauthorized prose edits slip through.
- **Forgetting UTC conversion on `pubDatetime`** — author's local time may already be past publish time, but UTC isn't.
