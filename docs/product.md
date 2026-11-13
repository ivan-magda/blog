# Product

## Platform

web

## Users

Software developers who read long technical articles about Swift performance and
concurrency, Apple platforms, and building AI agents and developer tools.

Their job on the site, as stated by the author: find an interesting article and
read it comfortably.

Reading devices, from the author's Umami "Devices" report (shared 2026-11-13,
covering the blog's whole lifetime): laptop 69%, mobile 22%, desktop 7%, tablet 1%.
Roughly three quarters read on a laptop or desktop screen; about one in five on
a phone. Both must read well; neither is an afterthought.

How readers arrive, from Umami reports for the same period (top rows only):

- Entry pages: readers land on an article, not the home page. Among the ten
  most common entry pages, nine are posts (2,024 visitors) and the home page
  accounts for 325, about 14%. One post, the Swift debounce investigation, is
  the entry page for 723 visitors.
- Channels: direct 55%, email 16%, referral 13%, organic social 9%, organic
  search 6%, LLM 4 visitors (under 1%).
- Top referrers: aocr.org 238, t.co (X) 226, google.com 136, github.com 63,
  substack.com 54, kagi.com 44, linkedin.com 41, bing.com 16,
  forums.swift.org 14.

So the typical first view is a single article opened from a shared link, a
newsletter, or a link aggregator. Search is a minor channel and AI search is
negligible so far. The home page and listings matter mostly as the second
step, for a reader who liked one article and wants another.

## Product Purpose

The personal technical blog of Ivan Magda at https://ivanmagda.dev. It publishes
his writing on what he builds and learns: measured Swift investigations, the
"Building a Coding Agent in Swift" series, and WWDC 2026
essays.

Success is a reader finding an article worth their time and finishing it without
the interface getting in the way, on any device.

## Positioning

First-hand engineering writing: benchmarks run on physical iPhones, agents built
stage by stage, runtime behaviour investigated and measured. Posts carry real
code, exact numbers, and interactive figures instead of summaries of other
people's work.

## Operating Context

- A typical visit is one long article: prose mixed with code listings, tables,
  charts, diagrams, and occasionally interactive figures.
- Articles are grouped into series and clusters (see `public/llms.txt`), so a
  reader of one part often wants the next or the previous one.
- Finding surfaces: home page (featured and recent posts), paginated `/posts/`,
  tags, archives, Pagefind search, RSS.
- Site language is English. Russian adaptations are published elsewhere (Habr).

## Capabilities and Constraints

Binding, stated by the author:

- Article texts must not change.
- URLs must not change. A post's URL comes from its frontmatter `slug`, and
  internal links end with `/`.
- The site keeps its minimalist character.
- The goal of current design work is readability and comfort on every device,
  desktop web and phone alike.

Existing functionality (observed in the repository; the author was asked which
parts are mandatory to keep and did not answer, so removing any of them needs
his approval):

- Light and dark themes with a toggle.
- Pagefind search, tags, archives, RSS, pagination, breadcrumbs, back button,
  back-to-top button.
- Post page: desktop table-of-contents rail from 1280px (no mobile equivalent
  yet), code copy buttons, share links, "Suggest Changes" link, chronological
  previous/next links.
- Interactive research figures and ASCII file trees as custom elements, with
  no-script text fallbacks and reduced-motion handling.
- Reading analytics via Umami (`docs/blog-analytics-umami-recipe.md`).
- SEO surface: meta tags, JSON-LD, generated OG images, sitemap, `llms.txt`
  (`docs/seo.md`).
- `hideFromFeed` and future-dated post gating.

Technical constraints: Astro 7 on an AstroPaper 5.5.1-derived template,
Tailwind v4 with CSS-first config, static build deployed to Cloudflare Pages.
See `CLAUDE.md` for the gotchas.

## Brand Commitments

- Name and title: "Ivan Magda". Tagline: "Writing about AI Engineering and
  Software Development."
- Minimalist character (author's explicit requirement).
- Voice: first person, direct, evidence-led; guidance lives in
  `.agents/memory/editorial.md`.

Typeface (decided by the author, 2026-11-13): Google Sans Code for the
interface, headings, code and figures; Google Sans for article prose. The
author weighed platform system fonts and chose Google Sans for a consistent
look everywhere. The pairing carries much of the site's identity, so any
further change must be deliberate and well executed.

## Evidence on Hand

- 27 posts in `src/data/blog/`, indexed with descriptions in `public/llms.txt`.
- About page copy in `src/pages/about.md`; projects swift-claw and
  swift-claude-code.
- Umami device, entry-page, channel, and referrer figures (above), lifetime
  totals as of 2026-11-13. Nothing else was shared; do not invent other
  audience data or testimonials.

## Product Principles

1. The article is the product. Chrome, navigation, and features serve reading
   and step back while it happens.
2. Every device gets a complete reading experience. Code, tables, and figures
   must work at phone width, not merely fit.
3. Finding the next article should take one obvious step: series order, related
   posts, search.
4. Content and addresses are permanent. Design changes never alter article text
   or URLs.
5. Add nothing that does not help a reader find or read. Minimalism is a
   constraint, not a style.

## Accessibility & Inclusion

No standard was set by the author. Existing commitments observed in code and
worth keeping: keyboard access and focus recovery in the table of contents,
`prefers-reduced-motion` handling, text fallbacks and `aria-label`s for
interactive figures, and both colour themes.
