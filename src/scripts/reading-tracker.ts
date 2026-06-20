// src/scripts/reading-tracker.ts
//
// Habr-style per-article reading analytics. Fires Umami custom events:
//   scroll-25 / scroll-50 / scroll-75 / scroll-100  (доскролл: reached this depth)
//   read-25 / read-50 / read-75 / read-100          (дочтение: read this quarter slowly enough)
//   time-on-page  { seconds }                        (active, visible-tab time)
//
// Scoped to blog posts (requires #article). Re-inits on Astro View Transitions:
// init() on astro:page-load, teardown() on astro:before-swap.

export {}; // module scope, required for `declare global`

declare global {
  interface Window {
    umami?: { track: (name: string, data?: Record<string, unknown>) => void };
    __readingTrackerEvents?: Array<{ name: string; data?: unknown; t: number }>;
    __readingTrackerState?: () => unknown;
  }
}

type Milestone = 25 | 50 | 75 | 100;
const MILESTONES: Milestone[] = [25, 50, 75, 100];

const DEFAULT_READ_CHARS_PER_SEC = 60; // дочтение velocity gate (Habr/Yandex), tunable
const READ_QUARTER_FRACTION = 0.6; // share of a quarter's chars read slowly to count

interface TrackerState {
  article: HTMLElement;
  totalChars: number;
  articleHeight: number;
  charsPerPixel: number;
  readCps: number;
  sentinels: HTMLElement[];
  scrollFired: Set<Milestone>;
  readFired: Set<Milestone>;
  quarterReadChars: Record<Milestone, number>;
  lastY: number;
  lastT: number;
  rafScheduled: boolean;
  visibleMs: number;
  visibleSince: number | null;
  sent: boolean;
}

let state: TrackerState | null = null;
let io: IntersectionObserver | null = null;
let ro: ResizeObserver | null = null;

// ---- debug helpers (inert unless ?trackerDebug=1 or localStorage flag) ----

function debugEnabled(): boolean {
  try {
    return (
      localStorage.getItem("reading-tracker.debug") === "1" ||
      new URLSearchParams(location.search).get("trackerDebug") === "1"
    );
  } catch {
    return false;
  }
}

function readCpsOverride(): number {
  if (!debugEnabled()) return DEFAULT_READ_CHARS_PER_SEC;
  const raw = new URLSearchParams(location.search).get("trackerReadCps");
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_READ_CHARS_PER_SEC;
}

// ---- event emission ----

function emit(name: string, data?: Record<string, number>) {
  window.umami?.track(name, data);
  if (debugEnabled()) {
    (window.__readingTrackerEvents ??= []).push({
      name,
      data,
      t: Math.round(performance.now()),
    });
    // eslint-disable-next-line no-console -- debug aid, gated behind debugEnabled()
    console.debug("[reading-tracker]", name, data ?? "");
  }
}

// ---- scroll milestones ----

function buildSentinels(article: HTMLElement): HTMLElement[] {
  if (getComputedStyle(article).position === "static") {
    article.style.position = "relative";
  }
  const frag = document.createDocumentFragment();
  const sentinels: HTMLElement[] = [];
  for (const pct of MILESTONES) {
    const s = document.createElement("div");
    s.dataset.readingMilestone = String(pct);
    // top:% is relative to the article's height, so sentinels auto-reposition
    // when lazy images/embeds change the height — no manual repositioning needed.
    s.style.cssText = `position:absolute;left:0;width:1px;height:1px;top:${pct}%;pointer-events:none;`;
    sentinels.push(s);
    frag.appendChild(s);
  }
  article.appendChild(frag);
  return sentinels;
}

function onIntersect(entries: IntersectionObserverEntry[]) {
  if (!state) return;
  for (const e of entries) {
    if (!e.isIntersecting) continue;
    const pct = Number(
      (e.target as HTMLElement).dataset.readingMilestone
    ) as Milestone;
    if (state.scrollFired.has(pct)) continue;
    state.scrollFired.add(pct);
    emit(`scroll-${pct}`);
    io?.unobserve(e.target);
    maybeFireRead(pct);
  }
}

// ---- read milestones (velocity gate) ----

function currentQuarter(s: TrackerState): Milestone | null {
  const top = s.article.getBoundingClientRect().top + window.scrollY;
  const frac = (window.scrollY + window.innerHeight - top) / s.articleHeight;
  if (frac <= 0) return null;
  if (frac <= 0.25) return 25;
  if (frac <= 0.5) return 50;
  if (frac <= 0.75) return 75;
  return 100;
}

function onScroll() {
  if (!state || state.rafScheduled) return;
  state.rafScheduled = true;
  requestAnimationFrame(sampleVelocity);
}

function sampleVelocity() {
  if (!state) return;
  state.rafScheduled = false;
  const now = performance.now();
  const y = window.scrollY;
  const dt = (now - state.lastT) / 1000; // seconds
  if (dt > 0) {
    const chars = Math.abs(y - state.lastY) * state.charsPerPixel;
    const velocity = chars / dt; // characters per second
    if (velocity <= state.readCps) {
      const q = currentQuarter(state);
      if (q) {
        state.quarterReadChars[q] += chars;
        maybeFireRead(q);
      }
    }
  }
  state.lastY = y;
  state.lastT = now;

  // Bottom-of-document fallback: if the sentinel at top:100% doesn't intersect
  // (short screen / layout edge case), ensure scroll-100 still fires.
  if (
    !state.scrollFired.has(100) &&
    window.scrollY + window.innerHeight >=
      document.documentElement.scrollHeight - 2
  ) {
    state.scrollFired.add(100);
    emit("scroll-100");
    maybeFireRead(100);
  }
}

function maybeFireRead(pct: Milestone) {
  if (!state || state.readFired.has(pct)) return;
  if (!state.scrollFired.has(pct)) return; // must have reached this depth first
  const budget = (state.totalChars / 4) * READ_QUARTER_FRACTION;
  if (budget <= 0) return;
  if (state.quarterReadChars[pct] >= budget) {
    state.readFired.add(pct);
    emit(`read-${pct}`);
  }
}

// ---- active time + flush ----

function accumulateVisible() {
  if (!state || state.visibleSince == null) return;
  state.visibleMs += performance.now() - state.visibleSince;
  state.visibleSince = null;
}

function onVisibilityChange() {
  if (!state) return;
  if (document.visibilityState === "hidden") {
    accumulateVisible();
    flush();
  } else {
    state.visibleSince = performance.now();
  }
}

function flush() {
  if (!state || state.sent) return;
  accumulateVisible();
  emit("time-on-page", { seconds: Math.round(state.visibleMs / 1000) });
  state.sent = true;
}

// ---- lifecycle ----

export function init() {
  teardown(); // idempotent: never stack handlers across soft navigations

  const article = document.getElementById("article");
  if (!article) return; // only run on blog post pages

  const totalChars = (article.textContent || "").length;
  const articleHeight = article.scrollHeight || 1;

  state = {
    article,
    totalChars,
    articleHeight,
    charsPerPixel: totalChars / articleHeight,
    readCps: readCpsOverride(),
    sentinels: [],
    scrollFired: new Set(),
    readFired: new Set(),
    quarterReadChars: { 25: 0, 50: 0, 75: 0, 100: 0 },
    lastY: window.scrollY,
    lastT: performance.now(),
    rafScheduled: false,
    visibleMs: 0,
    visibleSince:
      document.visibilityState === "visible" ? performance.now() : null,
    sent: false,
  };

  state.sentinels = buildSentinels(article);
  io = new IntersectionObserver(onIntersect, { threshold: 0 });
  state.sentinels.forEach(s => io!.observe(s));

  ro = new ResizeObserver(() => {
    if (!state) return;
    state.articleHeight = state.article.scrollHeight || 1;
    state.charsPerPixel = state.totalChars / state.articleHeight;
  });
  ro.observe(article);

  window.addEventListener("scroll", onScroll, { passive: true });
  document.addEventListener("visibilitychange", onVisibilityChange);
  window.addEventListener("pagehide", flush);

  if (debugEnabled()) {
    window.__readingTrackerEvents = [];
    window.__readingTrackerState = () =>
      state && {
        totalChars: state.totalChars,
        articleHeight: state.articleHeight,
        charsPerPixel: state.charsPerPixel,
        readCps: state.readCps,
        scrollFired: [...state.scrollFired],
        readFired: [...state.readFired],
        quarterReadChars: { ...state.quarterReadChars },
        visibleMs: Math.round(state.visibleMs),
        sent: state.sent,
      };
  }
}

export function teardown() {
  if (io) {
    io.disconnect();
    io = null;
  }
  if (ro) {
    ro.disconnect();
    ro = null;
  }
  window.removeEventListener("scroll", onScroll);
  window.removeEventListener("pagehide", flush);
  document.removeEventListener("visibilitychange", onVisibilityChange);
  if (state && !state.sent) flush(); // don't lose data on soft navigation
  if (state) state.sentinels.forEach(s => s.remove());
  state = null;
}
