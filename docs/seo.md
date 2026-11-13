# SEO & Meta Tags Reference

Detailed reference for the SEO machinery in `src/layouts/Layout.astro` and supporting files. CLAUDE.md keeps only the critical gotchas — everything else lives here.

## Layout.astro props

`Layout.astro` accepts these SEO-relevant props:

- `title` — renders `<title>`. Defaults to `SITE.title`. Paginated pages should append ` — Page N` for uniqueness using `page.currentPage`.
- `description` — renders `<meta name="description">`, `og:description`, `twitter:description` from a single source. Defaults to `SITE.desc`. Each page must pass an explicit `description` to avoid duplicates.
- `pageType` — `"website"` (homepage), `"article"` (blog posts), or `"webpage"` (default). Controls `og:type`, article meta tags, and JSON-LD schema type.
- `noindex` (boolean) — renders `<meta name="robots" content="noindex, follow">`. Used on tag index and tag listing pages.
- `hasMarkdown` (boolean) — renders `<link rel="alternate" type="text/markdown" href="<path>index.md">`. Set on posts, About and the home page, the pages that have a Markdown twin (see below).

## Canonicals

Self-referencing, handled automatically by `Layout.astro` via `Astro.url.pathname`.

## JSON-LD

Conditional by page type:

- Homepage (`pageType="website"`) — `WebSite` + `SearchAction`
- Blog posts (`pageType="article"`) — `BlogPosting` with `mainEntityOfPage`, `publisher`, `keywords`
- Other pages — none

`BreadcrumbList` schema is rendered separately by `src/components/Breadcrumb.astro`.

## Article meta

Blog posts get `article:published_time`, `article:author`, `article:tag`, `article:section`. `PostDetails.astro` passes `pageType="article"` and `tags` to Layout.

## Open Graph

`og:type`, `og:site_name`, `og:locale`, `og:image:width`, `og:image:height` on all pages.

## Twitter

Uses `name=` (not `property=`) per spec. `twitter:creator` reads from `SITE.twitterHandle`.

## OG images

- Default site OG: `public/og-image.png` (1200x630, minimal monospace design)
- Per-post dynamic OG images via Satori when `SITE.dynamicOgImage` is true

## Favicons

- SVG primary: `favicon.svg`
- PNG fallback: `favicon-32x32.png`
- Apple touch icon: `apple-touch-icon.png`

## RSS

`src/pages/rss.xml.ts` emits `<language>en</language>` and `categories` (from post tags) per item. No `author` field — RSS 2.0 spec requires email format.

## Sitemap

`astro.config.ts` sitemap filter excludes:

- `/tags/` pages — noindexed, near-duplicate content
- `/archives` — when `SITE.showArchives` is false

## Cross-linking

Blog posts in the series link to each other via Markdown links on existing "next guide" / "previous guide" references and concept mentions.

## Markdown for agents

Requests whose `Accept` header weights `text/markdown` at least as high as HTML get a Markdown copy of the page; browsers keep getting HTML.

- Markdown twins are built next to the HTML as `<path>index.md` by `src/pages/posts/[...slug]/index.md.ts` (frontmatter + raw post body), `src/pages/about/index.md.ts` (`about.md`) and `src/pages/index.md.ts` (home = `public/llms.txt`). Helpers live in `src/utils/markdownDocument.ts`.
- `functions/_middleware.ts` (a Cloudflare Pages Function, deployed by `wrangler pages deploy` from the repo root) serves the twin with `Content-Type: text/markdown; charset=utf-8`, `Vary: Accept`, an `x-markdown-tokens` estimate (characters / 4) and a canonical `Link` header. Pages without a twin (listings, tags, search) fall back to HTML. HTML page responses also get `Vary: Accept`.
- `public/_routes.json` keeps static assets (`/_astro/*`, images, Pagefind, `.md`/`.txt`/`.xml`/`.png`/`.svg`) out of the Function so they don't count against the Functions request quota.
- `public/_headers` gives the direct `.md` URLs a `Link: rel="canonical"` to the HTML page, and the home page `Link` headers (RFC 8288) to `llms.txt` (`describedby`), `/index.md` and the RSS feed for agent discovery.
- `robots.txt` declares `Content-Signal: search=yes, ai-input=yes, ai-train=yes` (author's choice, 2026-11-13).
- Test locally: `pnpm build`, then `pnpm dlx wrangler@4 pages dev dist` and `curl -H "Accept: text/markdown" http://localhost:8788/posts/<slug>/`. `astro preview` does not run the Function.
- Cloudflare's zone-level "Markdown for Agents" toggle (Pro plan and up) is not used; leave it off so the hand-built twins aren't bypassed.

## Static vs dynamic files

- Dynamic generation: `src/pages/*.ts` produces `robots.txt`, `rss.xml`, `og.png`, and the `index.md` Markdown twins
- Plain static: files in `public/`
