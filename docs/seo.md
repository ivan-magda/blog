# SEO & Meta Tags Reference

Detailed reference for the SEO machinery in `src/layouts/Layout.astro` and supporting files. CLAUDE.md keeps only the critical gotchas — everything else lives here.

## Layout.astro props

`Layout.astro` accepts these SEO-relevant props:

- `title` — renders `<title>`. Defaults to `SITE.title`. Paginated pages should append ` — Page N` for uniqueness using `page.currentPage`.
- `description` — renders `<meta name="description">`, `og:description`, `twitter:description` from a single source. Defaults to `SITE.desc`. Each page must pass an explicit `description` to avoid duplicates.
- `pageType` — `"website"` (homepage), `"article"` (blog posts), or `"webpage"` (default). Controls `og:type`, article meta tags, and JSON-LD schema type.
- `noindex` (boolean) — renders `<meta name="robots" content="noindex, follow">`. Used on tag index and tag listing pages.

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

## Static vs dynamic files

- Dynamic generation: `src/pages/*.ts` produces `robots.txt`, `rss.xml`, `og.png`
- Plain static: files in `public/`
