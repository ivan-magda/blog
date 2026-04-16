# CLAUDE.md

Personal blog: Astro v5 + AstroPaper v5.5.1 theme, deployed to GitHub Pages at https://ivanmagda.dev. Package manager: pnpm.

## Commands

```bash
pnpm run dev          # Dev server at localhost:4321
pnpm run build        # Production build (type check + astro build + pagefind index)
pnpm run preview      # Preview production build locally
pnpm run format       # Format with Prettier
pnpm run lint         # Lint with ESLint
pnpm run sync         # Generate Astro TypeScript types
```

## Critical gotchas

- **Tailwind v4, CSS-first config** — theme variables live in `src/styles/global.css` (5 vars: background, foreground, accent, muted, border). No `tailwind.config.*`.
- **Font config spans 3 files** — Google Sans Code via Astro experimental fonts API; changes must touch `astro.config.ts`, `src/layouts/Layout.astro`, AND `src/styles/global.css`.
- **Navigation is hardcoded** in `src/components/Header.astro` — not driven by `src/config.ts`.
- **Prev/Next post links are chronological** — `PostDetails.astro` overrides AstroPaper's default newest-first ordering.
- **`Main.astro`'s `pageDesc` prop is visible page text only** — it does NOT set the `<meta name="description">`. Pass an explicit `description` prop to `Layout.astro` for that.
- **Twitter meta uses `name=`, not `property=`** per spec. Don't "fix" it.
- **Update `public/llms.txt` when adding new posts** — used by AI search engines.
- **Custom domain via `public/CNAME`** — don't remove during build/deploy work.

## Pointers

- Blog post frontmatter schema → `src/content.config.ts`
- SEO / meta tags / JSON-LD / OG / RSS / sitemap details → `docs/seo.md`
- Site-wide config (URL, author, title, dynamicOgImage, showArchives) → `src/config.ts`
- Social and share link arrays → `src/constants.ts`
- Deploy workflow → `.github/workflows/deploy.yml` (uses `withastro/action@v6`)

Post body headings must use `##` or smaller — the frontmatter `title` renders as h1.
