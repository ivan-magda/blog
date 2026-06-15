# CLAUDE.md

Personal blog: Astro v5 + AstroPaper v5.5.1 theme, deployed to Cloudflare Pages at https://ivanmagda.dev. Package manager: pnpm.

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
- **Post URL = frontmatter `slug`, not filename** — Astro's glob loader uses `slug` as the entry id (`getPath`). Renaming a `.md` doesn't change its URL; edit `slug` plus any cross-links and `llms.txt`.
- **`hideFromFeed: true`** hides a post from every human surface (home, `/posts`, RSS, tags, archives, Pagefind search) while keeping it built, indexed, and in the sitemap. Gate is `postFilter.ts`; archives and the `data-pagefind-body` in `PostDetails.astro` are filtered separately — touch all three or the hide leaks.
- **Custom domain + `www`→apex 301 live in Cloudflare** (Pages custom domain + a Redirect Rule), not in the repo — there is no `CNAME` file.
- **Future-dated posts build immediately** — page + sitemap exist from day one (internal links to them work); only listings are gated by `postFilter.ts` until a rebuild after `pubDatetime`. Deploy is push-only, so a scheduled post appears only after a post-date push or manual workflow run.

## Pointers

- Blog post frontmatter schema → `src/content.config.ts`
- SEO / meta tags / JSON-LD / OG / RSS / sitemap details → `docs/seo.md`
- Research reports / deep-research outputs → `docs/research/` (e.g. Habr publishing playbook)
- Site-wide config (URL, author, title, dynamicOgImage, showArchives) → `src/config.ts`
- Social and share link arrays → `src/constants.ts`
- Deploy workflow → `.github/workflows/deploy.yml` (Cloudflare Pages via `cloudflare/wrangler-action`, Direct Upload)

Post body headings must use `##` or smaller — the frontmatter `title` renders as h1.
