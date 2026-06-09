# Cloudflare Pages Migration — Execution Plan

GitHub Pages → **Cloudflare Pages**, via **Direct Upload** from GitHub Actions.
Decided 2026-06-09 after deep research (`cloudflare-migration-research.md` / `-report.md`).

## Decision summary

- **Product:** Cloudflare Pages (not Workers Static Assets) — simplest for pure SSG, automatic `dist/404.html`, no `wrangler.jsonc`. No announced sunset; Pages→Workers is easy later if ever wanted.
- **Deploy method:** Direct Upload (`cloudflare/wrangler-action@v3`) — least-privilege token, keeps the existing GitHub Actions build + IndexNow pipeline, exact pnpm/Node pinning, no Cloudflare repo access.
- **No URL changes, no `astro.config.ts` changes.** Live URLs are trailing-slash directory format (`/posts/<slug>/`) and canonicals already match, so Cloudflare serves them with no redirect chains. The research report's `trailingSlash: 'never'` / `format: 'file'` suggestion was **rejected** — it would have rewritten every indexed URL.
- DNS already on Cloudflare (registrar + nameservers), currently DNS-only → GitHub Pages.

## Part A — Repo changes (done, on branch `migrate-cloudflare-pages`)

- Rewrote `.github/workflows/deploy.yml`: `pnpm build` → `wrangler pages deploy dist` → IndexNow (unchanged bash, `main` pushes only). PRs get preview deploys via `--branch`.
- **Project name in the workflow is `ivanmagda-dev`** — it MUST match the Pages project you create. Change one or the other to keep them in sync.
- Unchanged on purpose: `astro.config.ts`, `src/config.ts`, `public/CNAME`, all content, the build script.

### Optional follow-up (not included yet): asset caching

Add `public/_headers` for long-lived caching of hashed assets:

```
/_astro/*
  Cache-Control: public, max-age=31536000, immutable
/pagefind/*
  Cache-Control: public, max-age=86400
```

## Part B — Cloudflare dashboard (your steps)

1. **Create the Pages project** — Workers & Pages → Create application → Pages → **Direct Upload** (NOT "Connect to Git"). Name it **`ivanmagda-dev`**. Upload any placeholder to finish creation (the real deploy comes from CI). Set the **production branch to `main`** in the project's build/deployment settings.
2. **API token** — My Profile → API Tokens → Create Token → Custom Token. Permission: **Account · Cloudflare Pages · Edit**. Account Resources → your account. No Zone permission needed. Copy the token.
3. **Account ID** — Workers & Pages overview → copy the Account ID from the sidebar.
4. **GitHub secrets** — repo Settings → Secrets and variables → Actions → add `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.

## Part C — Cutover sequence (no downtime)

1. Merge `migrate-cloudflare-pages` → `main` **after** the secrets exist. First push runs the new workflow and deploys to `ivanmagda-dev.pages.dev`.
2. Verify the `*.pages.dev` build is correct (see Part D) **before touching DNS**. GitHub Pages stays live the whole time.
3. In the Pages project → **Custom domains → Set up a domain →** `ivanmagda.dev`. Cloudflare auto-creates the proxied CNAME (apex via CNAME flattening) and replaces the GitHub Pages DNS record. TLS provisions in ~minutes.
4. Wait for the custom domain to show **Active**, then re-verify on `https://ivanmagda.dev`.
5. **Decommission GitHub Pages:** repo Settings → Pages → Source = None.
6. (www, if you use it) DNS → add proxied `A www 192.0.2.1`, then Bulk Redirects → `www.ivanmagda.dev` → `https://ivanmagda.dev` (301, preserve path + query).

## Part D — Verification

```bash
curl -sI https://ivanmagda.dev | grep -i '^server:'        # expect: cloudflare (was GitHub.com)
curl -sI https://ivanmagda.dev/posts/                       # 200, trailing slash served directly
curl -sI https://ivanmagda.dev/nonexistent                  # 404 from dist/404.html
curl -s  https://ivanmagda.dev/sitemap-index.xml | head     # sitemap intact
curl -s  https://ivanmagda.dev/0f14d764-3ef3-4a68-b4b4-ae1fb15a8de2.txt   # IndexNow key
curl -s  https://ivanmagda.dev/llms.txt | head
curl -s  https://ivanmagda.dev/robots.txt
# Pagefind search assets present:
curl -sI https://ivanmagda.dev/pagefind/pagefind.js
```

Spot-check a real post URL is byte-for-byte the same path as before (trailing slash), and that search works in the browser.

## Part E — Post-cutover cleanup

- Remove `public/CNAME` (a GitHub Pages mechanism; a no-op on Cloudflare).
- Update `CLAUDE.md`: drop the "Custom domain via `public/CNAME` — don't remove" note and the GitHub Pages deploy references; point the deploy pointer at Cloudflare Pages + this plan.

## Rollback

DNS is the switch. If anything is wrong after cutover, in Cloudflare DNS point `ivanmagda.dev` back at GitHub Pages (re-enable GitHub Pages first if disabled). Because no URLs or content changed, rollback is just a DNS edit — no SEO fallout.
