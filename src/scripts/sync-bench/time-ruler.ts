import { el, fallbackText, segmented, svg, tween } from "./util";

type Item = {
  ns: number;
  text: string;
  label: string;
  kind?: "base" | "frame";
};

/** Results from the article (iPhone 15 Pro Max), in nanoseconds. */
const ITEMS: Item[] = [
  { ns: 0.27, text: "0.27 ns", label: "Atomic read or write" },
  {
    ns: 1.86,
    text: "1.86 ns",
    label: "Mutex: lock, change, unlock",
    kind: "base",
  },
  { ns: 6.36, text: "6.36 ns", label: "NSLock, uncontended" },
  { ns: 52.6, text: "52.6 ns", label: "actor call from a background task" },
  { ns: 203, text: "203 ns", label: "flag read through queue.sync" },
  { ns: 2020, text: "2.02 µs", label: "image cache read on the main thread" },
  {
    ns: 4890,
    text: "4.89 µs",
    label: "call from MainActor to an actor and back",
  },
  {
    ns: 19100,
    text: "19.1 µs",
    label: "dictionary call p99 under Mutex, eight threads",
  },
  { ns: 8.33e6, text: "8.33 ms", label: "one frame at 120 Hz", kind: "frame" },
  {
    ns: 12.95e6,
    text: "12.95 ms",
    label: "main thread waits for a Mutex held by a background thread",
  },
  {
    ns: 65.63e6,
    text: "65.63 ms",
    label: "the same wait with DispatchSemaphore",
  },
];
const BASE_NS = 1.86;

const PAD = 16;
const SPAN = 522;
const AXIS_X = 62;
const LABEL_X = 96;
const GAP = 6;
const LOG_MIN = -1;
const LOG_DECADES = 9;
const LINEAR_MAX = 70e6;
const LOG_TICKS = [
  "0.1 ns",
  "1 ns",
  "10 ns",
  "100 ns",
  "1 µs",
  "10 µs",
  "100 µs",
  "1 ms",
  "10 ms",
  "100 ms",
];

const logY = (ns: number) =>
  PAD + ((Math.log10(ns) - LOG_MIN) / LOG_DECADES) * SPAN;
const linearY = (ns: number) => PAD + (ns / LINEAR_MAX) * SPAN;

/** The duration rescaled so that one Mutex lock lasts one second. */
function humanScale(ns: number): string {
  const seconds = ns / BASE_NS;
  const round = (value: number) =>
    value >= 10 ? value.toFixed(0) : value.toFixed(1).replace(/\.0$/, "");
  if (seconds < 1) return `${seconds.toFixed(2)} seconds`;
  if (seconds < 1.05) return "1 second";
  if (seconds < 60) return `${round(seconds)} seconds`;
  if (seconds < 3600) return `${round(seconds / 60)} minutes`;
  if (seconds < 86400) return `${round(seconds / 3600)} hours`;
  if (seconds < 86400 * 365) return `${round(seconds / 86400)} days`;
  return `${round(seconds / (86400 * 365))} years`;
}

type Layout = { points: number[]; tops: number[]; height: number };

class TimeRuler extends HTMLElement {
  private progress = 0; // 0 = logarithmic, 1 = linear
  private cancel = () => {};
  private body!: HTMLElement;
  private drawing!: SVGSVGElement;
  private labels: HTMLElement[] = [];
  private leaders: SVGPathElement[] = [];
  private dots: SVGCircleElement[] = [];
  private tickGroups: SVGGElement[] = [];
  private layouts: [Layout, Layout] | null = null;
  private observer?: ResizeObserver;

  connectedCallback() {
    if (this.querySelector(".sb-figure")) return;
    const description = fallbackText(this);

    const scale = segmented(
      "Scale",
      [
        { id: "log", label: "Logarithmic" },
        { id: "linear", label: "Linear" },
      ],
      "log",
      id => this.animateTo(id === "linear" ? 1 : 0)
    );

    this.drawing = svg("svg", { class: "tr-drawing", "aria-hidden": "true" });
    this.drawing.append(
      svg("line", {
        class: "tr-axis",
        x1: AXIS_X,
        x2: AXIS_X,
        y1: PAD,
        y2: PAD + SPAN,
      })
    );
    this.tickGroups = [
      this.buildTicks(
        LOG_TICKS.map((text, index) => [text, logY(10 ** (index + LOG_MIN))])
      ),
      this.buildTicks(
        Array.from({ length: 8 }, (_, index) => [
          index === 0 ? "0" : `${index * 10} ms`,
          linearY(index * 10e6),
        ])
      ),
    ];
    this.drawing.append(...this.tickGroups);

    this.body = el(
      "div",
      { class: "tr-body", role: "img", "aria-label": description },
      this.drawing
    );
    for (const item of ITEMS) {
      const leader = svg("path", { class: "tr-leader" });
      const dot = svg("circle", {
        class: "tr-dot" + (item.kind ? ` is-${item.kind}` : ""),
        r: 3.5,
        cx: AXIS_X,
      });
      this.drawing.append(leader, dot);
      this.leaders.push(leader);
      this.dots.push(dot);
      const label = el(
        "div",
        { class: "tr-label" + (item.kind ? ` is-${item.kind}` : "") },
        el("div", {}, el("strong", { text: item.text }), ` ${item.label}`),
        el("div", {
          class: "tr-human",
          text:
            item.kind === "base"
              ? "1 second at human scale"
              : `${humanScale(item.ns)} at human scale`,
        })
      );
      this.body.append(label);
      this.labels.push(label);
    }

    const figure = el(
      "figure",
      { class: "sb-figure" },
      el("div", { class: "sb-controls" }, scale.node),
      this.body,
      el("figcaption", {
        class: "sb-caption",
        text: "Durations measured on the iPhone 15 Pro Max. Human scale stretches time so that locking a Mutex takes one second. On the linear scale everything faster than a millisecond lands on zero.",
      })
    );
    this.replaceChildren(figure);

    this.observer = new ResizeObserver(() => this.measure());
    this.observer.observe(this.body);
    this.measure();
  }

  disconnectedCallback() {
    this.observer?.disconnect();
    this.cancel();
  }

  private buildTicks(ticks: (string | number)[][]): SVGGElement {
    const group = svg("g", { class: "tr-ticks" });
    for (const [text, y] of ticks) {
      group.append(svg("line", { x1: AXIS_X - 5, x2: AXIS_X, y1: y, y2: y }));
      const label = svg("text", { x: AXIS_X - 9, y: Number(y) + 3.5 });
      label.textContent = String(text);
      group.append(label);
    }
    return group;
  }

  /** Place labels at their points, pushing each one below the previous label. */
  private place(points: number[], heights: number[]): Layout {
    const tops: number[] = [];
    let bottom = 0;
    points.forEach((point, index) => {
      const top = Math.max(point - heights[index] / 2, bottom + GAP, 0);
      tops.push(top);
      bottom = top + heights[index];
    });
    return { points, tops, height: Math.max(PAD * 2 + SPAN, bottom + PAD) };
  }

  private measure() {
    const heights = this.labels.map(label => label.offsetHeight);
    if (heights.every(height => height === 0)) return;
    this.layouts = [
      this.place(
        ITEMS.map(item => logY(item.ns)),
        heights
      ),
      this.place(
        ITEMS.map(item => linearY(item.ns)),
        heights
      ),
    ];
    this.draw();
  }

  private animateTo(target: number) {
    this.cancel();
    const from = this.progress;
    this.cancel = tween(900, t => {
      this.progress = from + (target - from) * t;
      this.draw();
    });
  }

  private draw() {
    if (!this.layouts) return;
    const [log, linear] = this.layouts;
    const mix = (a: number, b: number) => a + (b - a) * this.progress;
    this.body.style.height = `${mix(log.height, linear.height)}px`;
    this.tickGroups[0].style.opacity = String(1 - this.progress);
    this.tickGroups[1].style.opacity = String(this.progress);
    ITEMS.forEach((_, index) => {
      const point = mix(log.points[index], linear.points[index]);
      const top = mix(log.tops[index], linear.tops[index]);
      const label = this.labels[index];
      const anchor = top + Math.min(label.offsetHeight / 2, 10);
      label.style.transform = `translateY(${top}px)`;
      this.dots[index].setAttribute("cy", String(point));
      this.leaders[index].setAttribute(
        "d",
        `M${AXIS_X} ${point} L${AXIS_X + 12} ${point} L${LABEL_X - 14} ${anchor} L${LABEL_X - 6} ${anchor}`
      );
    });
  }
}

export function defineTimeRuler() {
  if (!customElements.get("time-ruler"))
    customElements.define("time-ruler", TimeRuler);
}
