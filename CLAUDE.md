# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Personal blog built with Astro v5 + AstroPaper v5.5.1 theme, deployed to GitHub Pages at https://ivanmagda.dev. Uses pnpm as package manager.

## Commands

```bash
pnpm run dev          # Dev server at localhost:4321
pnpm run build        # Production build (type check + astro build + pagefind index)
pnpm run preview      # Preview production build locally
pnpm run format       # Format with Prettier
pnpm run format:check # Check formatting
pnpm run lint         # Lint with ESLint
pnpm run sync         # Generate Astro TypeScript types
```

## Architecture

- **Site config** — `src/config.ts` is the single source of truth for site-wide settings (URL, author, title, etc.)
- **Social links** — `src/constants.ts` exports `SOCIALS` and `SHARE_LINKS` arrays
- **Blog posts** — Markdown files in `src/data/blog/` with YAML frontmatter (title, pubDatetime, description required)
- **Content schema** — `src/content.config.ts` defines the Zod schema and glob loader for the blog collection
- **Styling** — Tailwind CSS v4 with CSS-first config in `src/styles/global.css` (5 CSS variables per theme: background, foreground, accent, muted, border). Color scheme: "Warm Ink" (copper/amber)
- **Font** — Google Sans Code via Astro experimental fonts API, configured across `astro.config.ts`, `src/layouts/Layout.astro`, and `src/styles/global.css`
- **Navigation** — Hardcoded in `src/components/Header.astro`, not config-driven
- **Prev/Next post links** — Modified in `PostDetails.astro` to follow chronological order (not default newest-first)
- **Search** — Pagefind static search, indexed at build time
- **OG images** — Auto-generated via Satori when `SITE.dynamicOgImage` is true
- **Deployment** — `.github/workflows/deploy.yml` using `withastro/action@v3` + GitHub Pages

## SEO & Meta Tags

- **Meta description** — `Layout.astro` renders `<meta name="description">`, `og:description`, and `twitter:description` from a single `description` prop (defaults to `SITE.desc`). Each page must pass an explicit `description` prop to avoid duplicates.
- **Important**: `Main.astro`'s `pageDesc` prop is visible page text only — it does NOT set the meta description.
- **Titles** — `Layout.astro` renders `<title>` from a `title` prop (defaults to `SITE.title`). Paginated pages should append " — Page N" for uniqueness using `page.currentPage`.
- **Canonicals** — Self-referencing, handled automatically by `Layout.astro` via `Astro.url.pathname`.
- **llms.txt** — Static file in `public/llms.txt` for AI search engines. Update when adding new posts.
- **Static files** — Dynamic generation via `src/pages/*.ts` (robots.txt, rss.xml, og.png); plain static files in `public/`.

## Blog Post Frontmatter

```yaml
---
title: "Post Title"              # required
description: "Short summary"     # required
pubDatetime: 2026-03-10T10:00:00Z  # required, ISO 8601
author: "Ivan Magda"             # optional, defaults to SITE.author
slug: "custom-slug"              # optional, overrides filename
featured: false                  # optional, pins to homepage
draft: false                     # optional, hides in production
tags:                            # optional, defaults to ["others"]
  - swift
modDatetime: 2026-03-10T14:30:00Z  # optional, used for sorting if set
---
```

Post body headings must use `###` (h3) or smaller — the frontmatter `title` renders as h1.

## Current Content

9-part "Building a Coding Agent in Swift" series (s00–s08) with tags: swift, coding-agents, swift-claude-code. Dates staggered daily from 2026-03-10 to 2026-03-18.
