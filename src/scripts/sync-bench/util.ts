type Attrs = Record<string, string | number | boolean | undefined>;

/** Create an element with attributes (`class`, `text` and plain attributes). */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === false) continue;
    if (key === "class") node.className = String(value);
    else if (key === "text") node.textContent = String(value);
    else node.setAttribute(key, value === true ? "" : String(value));
  }
  node.append(...children);
  return node;
}

export const reducedMotion = () =>
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const placesFor = (value: number, digits?: number) =>
  digits ?? (Math.abs(value) >= 1000 ? 0 : Math.abs(value) >= 10 ? 1 : 2);

/** Format a measured value: two decimals below 10, one below 1,000, none above. */
export function formatValue(value: number, digits?: number): string {
  const places = placesFor(value, digits);
  return value.toLocaleString("en-US", {
    minimumFractionDigits: places,
    maximumFractionDigits: places,
  });
}

/** The value as the reader sees it, so that equal labels count as a tie when sorting. */
export const displayed = (value: number, digits?: number) =>
  Number(value.toFixed(placesFor(value, digits)));

/** Format a duration given in nanoseconds with a fitting unit. */
export function formatDuration(ns: number): string {
  if (ns < 1000) return `${formatValue(ns)} ns`;
  if (ns < 1e6) return `${formatValue(ns / 1e3)} µs`;
  return `${formatValue(ns / 1e6)} ms`;
}

export type Option = { id: string; label: string };

/** A row of toggle buttons where exactly one is pressed. */
export function segmented(
  label: string,
  options: Option[],
  current: string,
  onChange: (id: string) => void
) {
  const group = el("div", {
    class: "sb-seg",
    role: "group",
    "aria-label": label,
  });
  group.append(el("span", { class: "sb-seg-label", text: label }));
  const buttons = options.map(option => {
    const button = el("button", {
      type: "button",
      class: "sb-seg-btn",
      "aria-pressed": String(option.id === current),
      text: option.label,
    });
    button.addEventListener("click", () => {
      if (button.getAttribute("aria-pressed") === "true") return;
      set(option.id);
      onChange(option.id);
    });
    group.append(button);
    return button;
  });
  const set = (id: string) =>
    buttons.forEach((button, index) =>
      button.setAttribute("aria-pressed", String(options[index].id === id))
    );
  return { node: group, set };
}

/** Run `callback` once, the first time `node` scrolls into view. */
export function onFirstVisible(
  node: Element,
  callback: () => void,
  signal: AbortSignal
) {
  const observer = new IntersectionObserver(
    entries => {
      if (entries.some(entry => entry.isIntersecting)) {
        observer.disconnect();
        callback();
      }
    },
    { threshold: 0.25 }
  );
  observer.observe(node);
  signal.addEventListener("abort", () => observer.disconnect());
}

/** The text a not-yet-enhanced element carries: its description for readers without scripts. */
export function fallbackText(host: HTMLElement): string {
  return (host.textContent ?? "").replace(/\s+/g, " ").trim();
}

const SVG_NS = "http://www.w3.org/2000/svg";

/** Create an SVG element with attributes. */
export function svg<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number> = {}
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs))
    node.setAttribute(key, String(value));
  return node;
}

/** Drive `step` with eased progress from 0 to 1; returns a function that cancels the run. */
export function tween(
  duration: number,
  step: (progress: number) => void,
  ease: (t: number) => number = t => t * t * (3 - 2 * t)
): () => void {
  if (reducedMotion() || duration <= 0) {
    step(1);
    return () => {};
  }
  let frame = 0;
  const start = performance.now();
  const tick = (now: number) => {
    const t = Math.min(1, (now - start) / duration);
    step(ease(t));
    if (t < 1) frame = requestAnimationFrame(tick);
  };
  frame = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(frame);
}
