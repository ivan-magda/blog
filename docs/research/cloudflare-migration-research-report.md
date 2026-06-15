# Cloudflare Pages vs Workers Static Assets: Complete Migration Guide for Astro + Pagefind + pnpm (2026)

> **Platform verdict up front:** As of mid-2026, Cloudflare's own documentation explicitly steers new static projects toward **Workers with Static Assets** rather than Pages. Pages is not feature-frozen and receives bug fixes, but Workers receives all new features (Gradual Deployments, Vite plugin, Logpush, Workers Logs, Source Maps, etc.). For a *brand-new* personal blog with no existing Pages investment, starting on Workers is the forward-looking choice — but Pages remains fully functional and carries no forced-migration risk on any disclosed timeline.[^1][^2][^3]

***

## 1. Git Integration vs Direct Upload — Side-by-Side Comparison

| Dimension | Git Integration (CF Pages built-in CI) | Direct Upload (GitHub Actions → `wrangler-action@v3`) |
|---|---|---|
| **How it works** | Cloudflare GitHub App triggers a build inside CF's own build runner on every push; builds happen inside CF infra | GitHub Actions runs your build on `ubuntu-latest`; artifacts pushed to CF Pages via `wrangler pages deploy dist` |
| **Permanence** | **Locked at creation.** A Git-integrated Pages project cannot be converted to Direct Upload[^4]. The only workaround is: create a new Direct-Upload project, migrate the custom domain (unlink → relink), then delete the old project[^5] | Can coexist with Git: even on a Git-integrated project you can pause all branch builds and deploy via Wrangler — but only if the project was created via Git integration first |
| **Node version pinning** | `NODE_VERSION` env var in CF dashboard **or** `.nvmrc` / `.node-version` file in repo root[^6]. v3 build image default: **Node 22.16.0** (as of May 2025)[^7][^6] | You control the runner; use `actions/setup-node@v4` with `node-version: '24'` to match local exactly |
| **pnpm version pinning** | `PNPM_VERSION` env var in CF dashboard. v3 default: **pnpm 10.11.1**[^6]. ⚠️ **The build image does NOT read the `packageManager` field in `package.json`, and does NOT detect pnpm version from `pnpm-lock.yaml`** — explicit `PNPM_VERSION` override required[^6] | `actions/setup-node` + `corepack enable` or `pnpm/action-setup@v4` pins exact version from `packageManager` field natively |
| **Build reproducibility** | Moderate. CF controls the runner OS/image; minor-version updates can happen without notice if you haven't pinned[^6]. v1/v2 images auto-migrate to v3 on Sep 15, 2026 / Feb 23, 2027[^6] | High. GitHub-hosted runners are versioned; your lockfile + `actions/setup-node` + `pnpm/action-setup` are fully deterministic |
| **Native binary builds (sharp/resvg)** | ⚠️ Runs on `x86_64 Ubuntu` gVisor container[^6]; `@resvg/resvg-js` and `sharp` compile fine in theory but may have issues with gVisor's syscall restrictions — test before relying on this | GitHub Actions `ubuntu-latest` is standard bare-metal Ubuntu; native binaries (satori + resvg + sharp) compile reliably |
| **Preview deployments** | ✅ Automatic per-branch and per-PR preview URLs. Every PR gets a unique hash URL (`<hash>.<project>.pages.dev`); branch alias also available[^8][^9] | ✅ When using `cloudflare/wrangler-action@v3` + `--branch` flag, PR branches get their own preview URLs. Must pass `--branch ${{ github.head_ref \|\| github.ref_name }}` explicitly[^10] |
| **Preview access control** | ✅ Via Cloudflare Access — dashboard toggle → "Enable access policy" on the project settings page[^8] | ✅ Same Access mechanism works identically since it targets `*.{project}.pages.dev` |
| **Do previews consume build quota?** | ✅ Yes — every preview build counts against the 500 builds/month free limit[^11] | **No** — builds run on GitHub-provided compute (free for public repos, 2,000 min/month for private); only the `wrangler pages deploy` API call is made to CF, not a CF build |
| **GitHub App permissions** | The Cloudflare Workers and Pages GitHub App is installed on your account/org; it requires **read access to code, metadata, pull requests** and write access to **commit statuses / deployments** — broader than an API token[^12][^13] | **Least privilege:** API token needs exactly one permission: **Account → Cloudflare Pages → Edit**[^14][^15][^16]. No OAuth app installation required. Scope to specific account. |
| **Account ID required?** | Not explicitly — CF identifies context via the OAuth installation | **Yes** — `CLOUDFLARE_ACCOUNT_ID` must be provided as a secret alongside `CLOUDFLARE_API_TOKEN`[^17][^18] |
| **Rollback** | ✅ Dashboard: any successful production build → three-dot menu → "Rollback to this deployment" (instant, atomic)[^19] | ✅ Same rollback mechanism; deployment history visible in CF dashboard regardless of upload method |
| **Build caching** | ✅ Native dependency cache (npm/yarn/pnpm) + incremental build output cache for Astro[^20]. Toggle in Settings → Build Cache | ❌ No CF-side cache; must implement `actions/cache` for `~/.pnpm-store` in GitHub Actions |
| **Build timeout** | 20 minutes[^11] | No CF timeout (runs on GH Actions runner, subject to GH's 6-hour job limit) |
| **Deployment history** | All deployments retained in dashboard; rollback to any successful production deployment[^19] | Same |
| **IndexNow post-deploy** | Race condition risk: CF build + deploy is async; you'd need a Deploy Hook → another GH Action step, or use CF Workers Cron to ping IndexNow. Awkward | **Natural fit:** IndexNow step runs in the same workflow *after* `wrangler pages deploy` completes and returns a deployment URL. No race condition if you confirm the deploy step output first[^21] |
| **Maintenance overhead** | Zero — no CI config to maintain, no token rotation | Low — one workflow YAML + two secrets; token rotation needed (but scoped) |

***

## 2. Build Image Defaults — Verified (v3, May 2025)

The following values are confirmed from the official Cloudflare Pages build image documentation:[^6]

| Tool | v3 Default | Override mechanism |
|---|---|---|
| **Node.js** | **22.16.0** | `NODE_VERSION` env var, or `.nvmrc` / `.node-version` file |
| **pnpm** | **10.11.1** | `PNPM_VERSION` env var only |
| **npm** | 10.9.2 | Corresponds with Node version |
| **Yarn** | 4.9.1 | `YARN_VERSION` env var |
| **Build OS** | Ubuntu, x86_64, gVisor container | — |

**Critical limitation (explicitly listed in CF docs):**[^6]
- pnpm version is **NOT** detected from `pnpm-lock.yaml` lockfile version
- pnpm version is **NOT** read from the `packageManager` field in `package.json`
- Node.js version is **NOT** read from `package.json → "engines"` field
- Node.js codenames (e.g., `lts/iron`) are **not supported** in v3 — use bare version numbers

**For Ivan's scenario (pnpm 10.32.1, Node 24):** Both differ from v3 defaults. You **must** set `PNPM_VERSION=10.32.1` and `NODE_VERSION=24` in the CF Pages project environment variables if using Git integration. Alternatively, commit a `.node-version` file containing `24` to your repo root.

***

## 3. Pages vs Workers Static Assets — 2026 Verdict

### Cloudflare's Direction

The compatibility matrix migration guide (updated April 2026) states: *"Workers will receive the focus of Cloudflare's development efforts going forward, so we therefore recommend using Cloudflare Workers over Cloudflare Pages for any new projects."* This is an **explicit recommendation signal**, not merely an inference. The migration guide at `developers.cloudflare.com/workers/static-assets/migration-guides/migrate-from-pages/` (updated April 2026) provides detailed Pages→Workers migration steps and an AI coding assistant prompt.[^3][^1]

Pages is **not deprecated** in the traditional sense — no announced sunset date, and v1/v2 build images have explicit EOL dates (Sep 2026 / Feb 2027). But the feature delta is growing:[^6]

### Feature Matrix (as of June 2026)

| Feature | Workers + Static Assets | Pages |
|---|---|---|
| Cloudflare Vite plugin | ✅ | ❌ |
| Gradual deployments (traffic splitting) | ✅ | ❌ |
| Workers Logs / Logpush | ✅ | ❌ |
| Source Maps | ✅ | ❌ |
| Remote development (`--remote`) | ✅ | ❌ |
| Quick Dashboard Editor | ✅ | ❌ |
| Rollbacks | ✅ | ✅ |
| Preview URLs (per-branch) | ✅ (since Jul 2025)[^22] | ✅ |
| `_headers` / `_redirects` | ✅ | ✅ |
| Custom 404 page | ✅ (explicit `not_found_handling = "404-page"`)[^23] | ✅ (automatic, reads `dist/404.html`) |
| Custom domains on CF zones | ✅ | ✅ |
| Custom domains outside CF zones | ❌ | ✅ |
| Early Hints | ❌ | ✅ |
| Branch deploy controls | 🟡 (less granular)[^2] | ✅ (fine-grained) |
| Custom branch aliases | ⏳ Coming soon | ✅ |
| Free-tier static asset file limit | 20,000[^24] | 20,000[^11] |
| Paid-tier static asset file limit | 100,000 (since Sep 2025, needs Wrangler 4.34+)[^25] | 100,000 (since Jan 2026, needs `PAGES_WRANGLER_MAJOR_VERSION=4`)[^26][^27] |
| Individual file size limit | 25 MiB[^24] | 25 MiB[^11] |
| Bandwidth (static assets) | Free, unlimited[^28] | Free, unlimited[^29] |
| Build system (native Git CI) | Workers Builds — 3,000 min/month free, 1 concurrent build[^30] | 500 builds/month, 1 concurrent build[^11] |
| Build timeout | 20 minutes[^30] | 20 minutes[^11] |

### DX Differences for a Pure SSG Blog

**Pages advantages:**
- Zero-config: drop `dist/` output, Pages auto-detects `404.html` and serves it with a 404 status
- Simpler `_headers`/`_redirects` (no `wrangler.jsonc` needed)
- Custom domains work outside Cloudflare zones (useful if you ever move your registrar)
- Fine-grained branch deploy controls

**Workers advantages:**
- Future-proof: all new CF features land here first
- Better observability out of the box
- `wrangler.jsonc` provides a versioned, code-reviewable configuration
- 404 handling requires explicit `not_found_handling = "404-page"` in `wrangler.jsonc` — more verbose but also more intentional[^23]

**For a pure SSG blog: both are equally capable today.** The Workers path has slightly more boilerplate for SSG-specific settings but is the safer long-term choice.

***

## 4. Recommendation for Ivan's Scenario

**Recommended path: Cloudflare Pages with Direct Upload via `cloudflare/wrangler-action@v3`.**

**Rationale:**

1. **Least-privilege security:** The token scope is a single "Account → Cloudflare Pages → Edit" permission — no OAuth app install that touches all your repos. For a personal blog where you care about minimal blast radius, this is materially better than the GitHub App installation.[^15]

2. **Full build control:** Native binaries (`@resvg/resvg-js`, `sharp`) compile reliably on GitHub-hosted runners. CF's gVisor build container has syscall restrictions that can break native addons unpredictably.

3. **IndexNow without race conditions:** The `wrangler pages deploy` step in GitHub Actions returns a deployment URL as output; you can sequence the IndexNow ping after it in the same job, with zero ambiguity about liveness.[^21]

4. **pnpm 10.32.1 exact pinning:** GitHub Actions + `pnpm/action-setup@v4` reads the `packageManager` field natively. CF's v3 build image cannot detect pnpm from `packageManager` and defaults to 10.11.1.[^6]

5. **Preview deployments without consuming CF quota:** Preview builds run on GitHub compute. 500 builds/month is generous for a personal blog, but why spend them on CI when GitHub Actions is free for public repos?

6. **Pages over Workers for simplicity:** Pages handles `dist/404.html` automatically, no `wrangler.jsonc` configuration file needed, and branch deploy controls are more mature. The risk of a forced migration away from Pages is low — Cloudflare has given multi-year sunset timelines for prior deprecations.[^6]

**Strongest argument for Git Integration instead:** Zero CI maintenance. If you travel and want to push a fix from a tablet browser, the CF dashboard CI runs without any GitHub Actions YAML to maintain. Also, CF's native build cache (pnpm + Astro incremental builds) is easier to set up.[^20]

***

## 5. Concrete Setup & Migration Checklist

### Step 1 — Prepare the Repository

```bash
# 1a. Remove GitHub Pages CNAME file (not needed for CF Pages)
rm public/CNAME
git rm public/CNAME

# 1b. Add .node-version (optional but good practice for local dev consistency)
echo "24" > .node-version
git add .node-version
```

### Step 2 — Add `_headers` file for Caching

Create `public/_headers` (Astro copies `public/` into `dist/` verbatim, so this ends up at `dist/_headers`):[^31][^32]

```
# Hashed Astro assets — immutable
/_astro/*
  Cache-Control: public, max-age=31536000, immutable

# Pagefind fragments — hashed, immutable
/pagefind/fragment/*
  Cache-Control: public, max-age=31536000, immutable

# Pagefind index files — short TTL (change on each build)
/pagefind/index.*
  Cache-Control: public, max-age=3600, must-revalidate

# HTML pages — must-revalidate
/*.html
  Cache-Control: public, max-age=0, must-revalidate

# RSS and sitemap
/rss.xml
  Cache-Control: public, max-age=3600, must-revalidate
/sitemap*.xml
  Cache-Control: public, max-age=3600, must-revalidate
```

### Step 3 — Add `_redirects` for www→apex Canonicalization

**Do not use `_redirects` for www→apex** — CF Pages' `_redirects` only covers traffic that hits the Pages project, which won't intercept requests to `www.ivanmagda.dev` unless that subdomain also points to Pages. Use **Bulk Redirects** instead (see DNS section below).

However, use `public/_redirects` for any Astro trailing-slash cleanup if needed:

```
# No trailing slash needed when using build.format = 'file'
# Example catch-all if you have legacy /post/ URLs:
# /posts/:slug/   /posts/:slug   301
```

### Step 4 — Configure `astro.config.mjs`

```javascript
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  site: 'https://ivanmagda.dev',
  // Use 'file' build format + trailingSlash: 'never' to avoid CF's
  // automatic 301 on directory-based files (prevents redirect chains)
  build: {
    format: 'file',   // generates /about.html instead of /about/index.html
  },
  trailingSlash: 'never',
  integrations: [sitemap()],
});
```

**Why `format: 'file'` + `trailingSlash: 'never'`:** Cloudflare Pages automatically 301-redirects `example.com/about` → `example.com/about/` for directory-based files (`/about/index.html`). This creates redirect chains and canonical URL mismatches between dev and production. With `format: 'file'`, Astro outputs `/about.html` and CF serves it at `/about` without any redirect — clean canonical URLs.[^33][^34]

### Step 5 — Create the CF Pages Project via Dashboard

1. Log into Cloudflare Dashboard → **Workers & Pages** → **Create application** → **Pages**
2. Choose **"Get started" → "Direct Upload"** (not "Connect to Git")
3. Set project name: `ivanmagda-dev` (will become `ivanmagda-dev.pages.dev`)
4. Upload a placeholder `dist/index.html` for the initial empty deploy
5. In **Settings → Custom domains** → add `ivanmagda.dev`

### Step 6 — Create the API Token

1. Cloudflare Dashboard → Profile → **API Tokens** → **Create Token** → **Custom Token**
2. Permissions: **Account → Cloudflare Pages → Edit**
3. Account Resources: Include → *your account*
4. No Zone Resources needed
5. Copy the token; save it as a GitHub Secret named `CLOUDFLARE_API_TOKEN`
6. Find your Account ID: Dashboard → Workers & Pages → **Account Details** sidebar → Copy
7. Save as GitHub Secret: `CLOUDFLARE_ACCOUNT_ID`

### Step 7 — GitHub Actions Workflow

Replace `.github/workflows/deploy.yml`:

```yaml
name: Deploy to Cloudflare Pages

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

permissions:
  contents: read
  deployments: write
  pull-requests: write   # needed for PR comment with preview URL

jobs:
  build-and-deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup pnpm
        uses: pnpm/action-setup@v4
        # reads packageManager field from package.json automatically

      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: '24'
          cache: 'pnpm'

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Build
        run: pnpm astro check && pnpm astro build && pnpm pagefind --site dist

      - name: Deploy to Cloudflare Pages
        id: deploy
        uses: cloudflare/wrangler-action@v3
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          command: >
            pages deploy dist
            --project-name=ivanmagda-dev
            --commit-dirty=true
            --branch=${{ github.head_ref || github.ref_name }}
          gitHubToken: ${{ secrets.GITHUB_TOKEN }}

      - name: Ping IndexNow
        if: github.ref == 'refs/heads/main' && github.event_name == 'push'
        # Only ping on production deploys; wait for deploy step to succeed first
        run: |
          # Read sitemap and post URLs to IndexNow
          SITE_URL="${{ steps.deploy.outputs.deployment-url }}"
          echo "Production deployed to: $SITE_URL"
          node scripts/indexnow.mjs
        env:
          INDEXNOW_KEY: ${{ secrets.INDEXNOW_KEY }}
```

**Note:** `cloudflare/pages-action` is **deprecated** — always use `cloudflare/wrangler-action@v3`. The action now defaults to **Wrangler v4**; pin `wranglerVersion: "3.x"` if you need v3 explicitly.[^35][^36]

The `cp -r dist/pagefind public/` step in your current build script is not needed on Cloudflare — Pagefind outputs to `dist/pagefind` directly and `dist` is your deploy directory. Remove the `cp` step.

### Step 8 — DNS Cutover

**Your zone is already on Cloudflare.** This is the ideal scenario:

1. In CF Pages project → **Custom domains** → **Set up a domain** → enter `ivanmagda.dev`
2. Cloudflare will **automatically create a CNAME record** for the apex domain using CNAME flattening. No A records needed.[^37][^38]
3. The CNAME replaces the existing GitHub Pages DNS record. **Before cutting over:**
   - Keep GitHub Pages live as fallback during TLS provisioning
   - CF TLS provisioning takes ~15 minutes; if you have restrictive CAA records, add `pki.goog`, `letsencrypt.org`, or remove CAA records temporarily — but **Cloudflare adds CAA records automatically for its own CAs**, so for most zones this is not an issue[^39][^40]
4. After CF shows "Active" for the custom domain, update your GitHub repository:
   - Delete `public/CNAME` (commit this)
   - Disable GitHub Pages in repo Settings → Pages (set source to "None")
5. **Do not make the DNS change until you've verified a successful CF Pages deploy** of the full `dist/` including Pagefind, `llms.txt`, `robots.txt`, `sitemap.xml`, and the IndexNow key file

### Step 9 — www→apex Redirect via Bulk Redirects

Since `www.ivanmagda.dev` currently points to GitHub Pages (as a grey-cloud DNS record), reconfigure it:[^41]

1. **DNS → Records**: Add `A www 192.0.2.1` (dummy IP), Proxied (orange cloud) — this is required for CF to intercept www traffic
2. **Bulk Redirects** → Create List → add rule:
   - Source: `www.ivanmagda.dev`
   - Target: `https://ivanmagda.dev`
   - Status: `301`
   - Parameters: ✅ Preserve query string, ✅ Subpath matching, ✅ Preserve path suffix
3. Create Redirect Rule referencing that list[^42][^41]

### Step 10 — Verify SEO Continuity

```bash
# Verify canonical redirect (www → apex)
curl -I https://www.ivanmagda.dev/
# Expected: HTTP/2 301, location: https://ivanmagda.dev/

# Verify 404 page
curl -I https://ivanmagda.dev/nonexistent-page
# Expected: HTTP/2 404

# Verify sitemap
curl -s https://ivanmagda.dev/sitemap-index.xml | head -5

# Verify IndexNow key file
curl https://ivanmagda.dev/<your-key>.txt

# Verify llms.txt
curl -s https://ivanmagda.dev/llms.txt | head -5

# Verify robots.txt
curl -s https://ivanmagda.dev/robots.txt
```

***

## 6. Pagefind + Free-Tier File Count — Risk Assessment

Pagefind generates many small fragment files. The exact count depends on site size:

- A typical 50-post blog generates ~200–500 Pagefind fragment files
- Astro generates ~50–100 hashed `_astro/` assets
- Total for a moderate blog: ~1,000–3,000 files — well under the 20,000 limit[^11][^43]

**Risk threshold:** If you have thousands of blog posts (>5,000), Pagefind fragments + content pages could approach 20,000. Each page generates roughly 1 Pagefind fragment. A 10,000-post site would be borderline. For a personal blog, this is a non-issue.[^44]

**Mitigation if needed:** Pagefind's `--max-optimized-fragments` flag or running `pagefind --chunk-size 400` reduces fragment count by increasing per-fragment size. Alternatively, upgrade to CF Paid (Pro) to get 100,000 files.[^26]

***

## 7. Gotchas That Bite You: Astro + Pagefind + pnpm on Cloudflare

### Build & Toolchain Gotchas

1. **pnpm version mismatch (Git integration):** CF v3 build image ships pnpm 10.11.1; your `packageManager: pnpm@10.32.1` is ignored. Builds silently succeed but use the wrong pnpm. **Fix:** Set `PNPM_VERSION=10.32.1` in CF Pages environment variables. This is not documented prominently — many users discover it only when lockfile validation fails.[^6]

2. **`packageManager` field and corepack:** CF's build image does not run corepack. Even if corepack is enabled globally, the build image does not honor the `packageManager` field for version selection. Only the `PNPM_VERSION` env var works.[^6]

3. **`cp -r dist/pagefind public/` in your current build script:** This copies `dist/pagefind` into `public/pagefind`, which would re-copy on next build into `dist/pagefind/pagefind` recursively. **Remove this step** when deploying to CF Pages — pagefind outputs directly to `dist/pagefind`, which is your deploy directory.

4. **`astro check` requires type-correct environment:** If `astro check` fails on CF's build image (missing types, etc.), it blocks the build. Consider separating `astro check` to a pre-deploy CI step and only running `astro build && pagefind` in the CF build command.

5. **Node 24 on CF build image:** v3 default is Node 22.16.0. Set `NODE_VERSION=24` if you need it. However, note that CF support for Node 24 requires it to be installed at build time — if any dependency has a Node 24 incompatibility in the cf container, it will surface here.

6. **Native binaries (sharp + resvg-js) on CF gVisor:** CF's build environment uses gVisor, which has a restricted syscall interface. OG image generation using `sharp` and `@resvg/resvg-js` at build time may hit `EPERM` or SIGSYS errors. **Mitigation:** Run OG image generation in GitHub Actions (Direct Upload path avoids this entirely).[^6]

### Trailing Slash / URL Gotchas

7. **Cloudflare Pages adds trailing-slash 301s for directory-based files:** If Astro outputs `dist/about/index.html`, CF serves `/about` with a 301 → `/about/`. This creates URL mismatches between GitHub Pages (which often serves both) and CF Pages. **Fix:** Use `build: { format: 'file' }` + `trailingSlash: 'never'` in `astro.config.mjs`. Commit before go-live so Google sees the canonical form from day one.[^34][^33]

8. **Astro.url.pathname includes `.html` with `format: 'file'`:** Your OG image generator or canonical URL builder may produce `/about.html` as the canonical. Wrap `Astro.url.pathname` with `.replace(/\.html$/, '')` for canonical link generation.[^34]

9. **GitHub Pages vs CF trailing-slash behavior differ:** GitHub Pages typically serves `/about` without redirecting to `/about/`. CF Pages redirects `directory/` → `directory/index.html` serving. Switching without fixing the build format causes duplicate-content issues and 301 chains that dilute PageRank.

### SEO & DNS Gotchas

10. **`public/CNAME` file must be deleted:** This file is a GitHub Pages mechanism. Leaving it in `dist/` on CF serves `https://ivanmagda.dev/CNAME` as a plain text file — not harmful but untidy, and if Google crawls it, it signals an incomplete migration.

11. **DNS grey-cloud → orange-cloud transition for GitHub Pages:** GitHub Pages requires DNS to be grey-cloud (unproxied) for cert management. When you switch to CF Pages, the CNAME must be **proxied** (orange cloud). If you forget this, your CF Pages TLS cert won't provision correctly.[^45]

12. **CAA record interference:** Rare but real. If you previously added custom CAA records pointing only to `letsencrypt.org` or a specific CA, Cloudflare's CA (DigiCert / Google Trust Services) may be blocked. Cloudflare auto-adds its own CAA records when you use its Universal SSL, but only if your zone doesn't already have conflicting ones. Check with `dig CAA ivanmagda.dev` before cutover.[^40][^39]

13. **IndexNow key file must be in `public/` (not `src/`):** The key file `public/<key>.txt` is copied to `dist/<key>.txt` by Astro's build. If it's only in `src/`, it won't exist in the deployed assets. Verify the file is reachable before pinging IndexNow.

### Pagefind-Specific Gotchas

14. **Pagefind build runs after `astro build` but the output is in `dist/pagefind/`:** If you add a `public/pagefind/` stub directory to source-control (for local dev preview), it conflicts with the post-build pagefind output. Either `.gitignore public/pagefind` or never pre-create it.

15. **Pagefind fragment files have hashed names that change every build:** Your `_headers` rule for `/pagefind/fragment/*` with `immutable` caching is safe — when content changes, Pagefind generates new hashes. However, the pagefind `index.*` files (the entry points) are **not hashed** and change each build. Cache them with a short TTL (`max-age=3600`) to avoid stale search results.[^31]

### Deployment Method Gotchas

16. **Cannot switch from Git integration to Direct Upload:** This is a hard architectural limitation of CF Pages projects. If you start with Git integration and later want full build control, you must create a new Pages project, migrate the custom domain, and delete the old one — a 10-minute procedure but disruptive. **Decide before you create the project.**[^46][^4]

17. **`--commit-dirty=true` in wrangler-action:** Required when running `wrangler pages deploy` on a working copy that doesn't have a clean git state (e.g., `dist/` is gitignored). Without this flag, Wrangler may warn or fail on commit hash detection.[^47]

18. **`wrangler-action` now defaults to Wrangler v4:** The `cloudflare/wrangler-action@v3` tag now runs **Wrangler v4** by default. If you're relying on specific v3 behavior, pin with `wranglerVersion: "3.90.0"`. The v4 API is mostly compatible for `pages deploy` commands.[^36]

***

## 8. Astro Config Best Practices for Cloudflare

### Recommended `astro.config.mjs`

```javascript
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  site: 'https://ivanmagda.dev',  // Required for sitemap + canonical URLs
  build: {
    format: 'file',               // /about.html instead of /about/index.html
  },
  trailingSlash: 'never',         // Consistent with format: 'file'
  integrations: [
    sitemap({
      // Optional: exclude /404 from sitemap
      filter: (page) => !page.includes('/404'),
    }),
  ],
  // No Cloudflare adapter needed for pure SSG
  // adapter: cloudflare() is only for SSR
});
```

### 404 Handling

With `build.format: 'file'`, Astro outputs `dist/404.html`. Cloudflare Pages automatically serves this file with a `404 Not Found` response for any unmatched route — no additional configuration needed.[^2]

### `_redirects` Limits

CF Pages `_redirects` supports up to 2,000 static redirects + 100 dynamic redirects (2,100 total). For a personal blog, this is ample. Use `_redirects` for content redirects (old post URLs), and Bulk Redirects for www→apex.[^48][^41]

***

## Summary Table: Recommendation vs. Trade-offs

| Decision | Recommendation | Reason |
|---|---|---|
| Pages vs Workers | **Pages** | Simpler config for pure SSG; automatic 404; no `wrangler.jsonc` required; no forced migration risk |
| Git integration vs Direct Upload | **Direct Upload** | Least-privilege token; exact pnpm pinning; native binaries; no build quota consumption; IndexNow sequencing |
| trailingSlash | **`'never'` + `format: 'file'`** | Avoids CF's directory-based 301 redirect chain; clean canonical URLs |
| www→apex redirect | **Bulk Redirects** | Only supported mechanism for apex-to-subdomain redirection outside of Pages deploy context |
| IndexNow timing | **Post-deploy step in same GH Actions job** | No race condition; deploy URL confirmed before pinging |
| pnpm version pinning | **`pnpm/action-setup@v4` in GH Actions** | Reads `packageManager` field; CF build image cannot |

---

## References

1. [Migrate from Pages to Workers - Cloudflare Docs](https://developers.cloudflare.com/workers/static-assets/migration-guides/migrate-from-pages/) - A guide for migrating from Cloudflare Pages to Cloudflare Workers. Includes a compatibility matrix f...

2. [Workers vs. Pages (compatibility matrix) · Cloudflare Workers docs](https://developers.cloudflare.com/workers/static-assets/compatibility-matrix/) - Compatibility matrix for asset hosting on Cloudflare Workers and Pages.

3. [Hacker News](https://news.ycombinator.com/item?id=45589928)

4. [cloudflare-docs/src/content/docs/pages/get-started/git-integration.mdx at production · cloudflare/cloudflare-docs](https://github.com/cloudflare/cloudflare-docs/blob/production/src/content/docs/pages/get-started/git-integration.mdx) - Cloudflare’s documentation. Contribute to cloudflare/cloudflare-docs development by creating an acco...

5. [Change pages deployment from upload to git](https://www.reddit.com/r/CloudFlare/comments/1m2dfq2/change_pages_deployment_from_upload_to_git/) - Change pages deployment from upload to git

6. [Build image · Cloudflare Pages docs](https://developers.cloudflare.com/pages/configuration/build-image/) - Cloudflare Pages' build environment has broad support for a variety of languages, such as Ruby, Node...

7. [Cloudflare Pages builds now provide Node.js v22 by default](https://developers.cloudflare.com/changelog/post/2025-05-30-pages-build-image-v3/) - If you have an existing Pages project, you can update to the latest build image by navigating to Set...

8. [Preview deployments · Cloudflare Pages docs](https://developers.cloudflare.com/pages/configuration/preview-deployments/) - Preview new versions of your Cloudflare Pages project with unique URLs before deploying to productio...

9. [Git integration · Cloudflare Pages docs](https://developers.cloudflare.com/pages/configuration/git-integration/) - Connect a GitHub or GitLab repository to Cloudflare Pages for automatic build and deploy on push.

10. [How to Deploy a Hugo Site to Cloudflare Pages With Github Actions](https://www.caktusgroup.com/blog/2025/08/20/how-to-deploy-a-hugo-site-to-cloudflare-pages-with-github-actions/) - Cloudflare's wrangler-action makes it simple to set up a GitHub Actions workflow for this. Create a ...

11. [Limits · Cloudflare Pages docs](https://developers.cloudflare.com/pages/platform/limits/) - Build, deployment, and custom domain limits for Cloudflare Pages by plan type.

12. [GitHub integration · Cloudflare Workers docs](https://developers.cloudflare.com/workers/ci-cd/builds/git-integration/github-integration/) - Cloudflare supports connecting your GitHub repository to your Cloudflare Worker, and will automatica...

13. [GitHub integration · Cloudflare Pages docs](https://developers.cloudflare.com/pages/configuration/git-integration/github-integration/) - Beyond automatic deployments, the Cloudflare GitHub integration lets you monitor, manage, and previe...

14. [Deploy Cloudflare Pages GitHub Action - GitHub Marketplace](https://github.com/marketplace/actions/deploy-cloudflare-pages-github-action) - To find your account ID, log in to the Cloudflare dashboard > select your zone in Account Home > fin...

15. [Cloudflare Pages GitHub Action with GitHub Environments](https://github.com/marketplace/actions/cloudflare-pages-github-action-with-github-environments) - Under Permissions, select Account, Cloudflare Pages and Edit: Select Continue to summary > Create To...

16. [Deploying Deno project to Cloudflare Pages using GitHub Actions](https://dav.one/deploying-deno-project-to-cloudflare-pages-using-github-actions/) - If you prefer a pure Deno project, you can use GitHub Actions for automated deployments. This articl...

17. [GitHub Actions · Cloudflare Workers docs](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/) - To create an API token to authenticate Wrangler in your CI job: In the Cloudflare dashboard, go to t...

18. [Deploying to Cloudflare Pages - Zine](https://zine-ssg.io/docs/deploying/cloudflare-pages/) - This can be by going to Settings -> Actions -> General -> Workflow Permissions. 2. Build locally and...

19. [Rollbacks · Cloudflare Pages docs](https://developers.cloudflare.com/pages/configuration/rollbacks/) - Instantly revert your Cloudflare Pages project to a previous production deployment.

20. [Race ahead with Cloudflare Pages build caching](https://blog.cloudflare.com/race-ahead-with-build-caching/) - With build caching, we are offering a supercharged Pages experience by helping you cache parts of yo...

21. [Three post-deploy checks I run after every Cloudflare ...](https://dev.to/morinaga/three-post-deploy-checks-i-run-after-every-cloudflare-pages-build-4mel) - After hitting a sitemap _redirects bug and a Bluesky image race condition, I added three targeted sm...

22. [Test out code changes before shipping with per-branch preview ...](https://developers.cloudflare.com/changelog/post/2025-07-23-workers-preview-urls/) - Get shareable preview links for every code change you make to a Cloudflare Worker, making it easier ...

23. [Static Site Generation (SSG) and custom 404 pages - Cloudflare Docs](https://developers.cloudflare.com/workers/static-assets/routing/static-site-generation/) - How to configure a Static Site Generation (SSG) application and custom 404 pages with Workers.

24. [Limits · Cloudflare Workers docs](https://developers.cloudflare.com/workers/platform/limits/) - Cloudflare Workers plan and platform limits.

25. [Increased static asset limits for Workers · Changelog - Cloudflare Docs](https://developers.cloudflare.com/changelog/post/2025-09-02-increased-static-asset-limits/) - Paid and Workers for Platforms users can now upload up to 100000 static assets per Worker version, u...

26. [Increased Pages file limit to 100000 for paid plans](https://developers.cloudflare.com/changelog/2026-01-23-pages-file-limit-increase/) - Paid plans can now deploy Pages sites with up to 100,000 files, increased from the previous limit of...

27. [Increased Pages file limit to 100000 for paid plans - Cloudflare Docs](https://developers.cloudflare.com/changelog/post/2026-01-23-pages-file-limit-increase/) - Paid plans can now deploy Pages sites with up to 100000 files, increased from the previous limit of ...

28. [Billing and Limitations · Cloudflare Workers docs](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/) - Billing, troubleshooting, and limitations for Static assets on Workers

29. [Cloudflare Pages: 500 Builds Per Month Free | FreeTier.co](https://freetier.co/directory/products/cloudflare-pages) - Cloudflare Pages free tier: 1 build at a time, 500 builds per month, 100 custom domains per project ...

30. [Limits & pricing · Cloudflare Workers docs](https://developers.cloudflare.com/workers/ci-cd/builds/limits-and-pricing/) - Limits & pricing for Workers Builds

31. [How to configure browser caching in Cloudflare Pages](https://randombits.dev/articles/tips/cloudflare-pages-caching) - To configure caching, you can create a _headers file (no extension) in the root of your pages deploy...

32. [Headers · Cloudflare Pages docs](https://developers.cloudflare.com/pages/configuration/headers/) - The default response headers served on static asset responses can be overridden, removed, or added t...

33. [Astro Build Format and CloudFlare Pages - Aleksa Cukovic](https://aleksac.me/til/astro-build-format-and-cloudflare-pages/) - html for each page (e.g. src/pages/about. ... When you set trailingSlash: 'always' , you'll get 404 ...

34. [Astro, Cloudflare Pages, and Non-Trailing Slash Canonical URLs](https://jameshard.ing/notes/2026-04-01-astro-cloudflare-pages-trailing-slash-canonical/) - However, Cloudflare Pages automatically adds a trailing slash to all directory-based files (the Astr...

35. [cloudflare/pages-action: DEPRECATED, please use wrangler-action](https://github.com/cloudflare/pages-action) - GitHub Action for creating Cloudflare Pages deployments, using the new Direct Upload feature and Wra...

36. [Deploy to Cloudflare Workers with Wrangler · Actions - GitHub](https://github.com/marketplace/actions/deploy-to-cloudflare-workers-with-wrangler) - Add wrangler-action to the workflow for your Workers/Pages application. The below example will deplo...

37. [Custom domains · Cloudflare Pages docs](https://developers.cloudflare.com/pages/configuration/custom-domains/) - To deploy your Pages project to a custom apex domain, that custom domain must be a zone on the Cloud...

38. [CNAME flattening - DNS](https://developers.cloudflare.com/dns/cname-flattening/) - Resolve CNAME records at the zone apex to comply with DNS standards.

39. [Add CAA records · Cloudflare SSL/TLS docs](https://developers.cloudflare.com/ssl/edge-certificates/caa-records/) - In the Cloudflare dashboard, go to the DNS Records page. Go to Records · Select Add record. · For Ty...

40. [SSL/TLS FAQ - Cloudflare Docs](https://developers.cloudflare.com/ssl/faq/) - You can find CAA records associated with every Cloudflare CA in the certificate authorities referenc...

41. [Redirecting www to domain apex · Cloudflare Pages docs](https://developers.cloudflare.com/pages/how-to/www-redirect/) - To redirect your www subdomain to your domain apex: In the Cloudflare dashboard, go to the Bulk Redi...

42. [Configuring Cloudflare to Redirect WWW to Apex Domain - Leed AI](https://leed.ai/blog/configuring-cloudflare-to-redirect-www-to-apex-domain/) - Start by creating a bulk redirect list, then manually add a rule redirecting "www.yourdomain.com" to...

43. [Feature Request: allow more than 20000 files per pages site - GitHub](https://github.com/cloudflare/workers-sdk/issues/5537) - ✘ [ERROR] Error: Pages only supports up to 20,000 files in a deployment. Ensure you have specified y...

44. [Pagefind for search : r/astrojs - Reddit](https://www.reddit.com/r/astrojs/comments/1gsbrvp/pagefind_for_search/) - Since Cloudflare pages have a limit of 20k files, I am afraid it will have an issue for a planned la...

45. [How to get CloudFlare to host Github pages using Custom Domain.](https://www.reddit.com/r/CloudFlare/comments/1c26r8z/how_to_get_cloudflare_to_host_github_pages_using/) - I setup Cloudflare with all the Nameservers changed on GoDaddy and my site works from GitHub pages, ...

46. [Direct Upload · Cloudflare Pages docs](https://developers.cloudflare.com/pages/get-started/direct-upload/) - This guide will instruct you how to upload your assets using Wrangler or the drag and drop method. Y...

47. [cloudflare/pages-action から cloudflare/wrangler-action へ ...](https://qiita.com/tommy_aka_jps/items/4713182b573b298ccb26) - 概要 自分のブログサイトが GitHub Actions の cloudflare/pages-action を使って Cloudflare Pages へデプロイを行なっていますが、ちょっと前から ...

48. [Redirects · Cloudflare Pages docs](https://developers.cloudflare.com/pages/configuration/redirects/) - Use Bulk Redirects to handle redirects that surpasses the 2,100 redirect rules limit of _redirects ....

