# Blog reading analytics — Umami recipe

The reading tracker (`src/scripts/reading-tracker.ts`) fires these Umami custom events on every blog post:

- `scroll-25` / `scroll-50` / `scroll-75` / `scroll-100` — reached this depth (доскролл)
- `read-25` / `read-50` / `read-75` / `read-100` — read this quarter slowly enough (дочтение)
- `time-on-page` with a `seconds` property — active, visible-tab time

All events auto-attach to the current page URL, so scope every report below with a filter `path = /posts/<slug>`.

## Scroll-through funnel (доскролл)
Umami → Funnels → new funnel, steps `scroll-25 → scroll-50 → scroll-75 → scroll-100`. Add filter `path = /posts/<slug>`.

## Read-through funnel (дочтение)
Same, steps `read-25 → read-50 → read-75 → read-100`. Read-% sits below scroll-% on every article; the gap is the skim-vs-read signal.

## Average active time
Events → `time-on-page` → Properties → `seconds`. Read average/median off the value distribution, filtered by URL.

## Bounce rate (your definition)
Derive from the `seconds` distribution (share of visits under your chosen threshold, e.g. 10s). Ignore Umami's native bounce/duration for articles — it is single-pageview-based and meaningless for a blog. Any milestone event already marks a visit as a non-bounce in Umami's model.

## Views over time
Standard pageview chart, filtered by `path`. Already free.

## Tuning the read gate
`DEFAULT_READ_CHARS_PER_SEC` in the tracker defaults to 60 (Habr/Yandex дочтение cutoff). If read-% ≈ scroll-% everywhere, lower it; if read-% is implausibly low, raise it.

Note that read-% is a coarse heuristic, not a calibrated per-section measurement. The velocity gate estimates chars/sec from `charsPerPixel = totalChars / articleHeight` applied to window scroll deltas, so scrolling through page chrome below the article (tags, share links, prev/next, footer) is attributed to the final quarter. Treat read-% as a relative read-vs-skim signal rather than an exact reading fraction.

## Exclude your own visits
In your browser console (once), run `localStorage.setItem("umami.disabled", "1")`. Umami honours this flag natively and stops sending any events from that browser, keeping a low-traffic blog's funnels clean. Undo with `localStorage.removeItem("umami.disabled")`.

## Debugging the tracker locally
Append `?trackerDebug=1` to any post URL to populate `window.__readingTrackerEvents` and `window.__readingTrackerState()` and log each event to the console. Add `&trackerReadCps=<n>` to override the read-velocity threshold for experimentation.
