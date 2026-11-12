import data from "./data.json";
import {
  el,
  fallbackText,
  formatValue,
  onFirstVisible,
  segmented,
  tween,
} from "./util";

type Owner = "single" | "none" | "multiple";
type Lock = { id: string; label: string; owner: Owner };

const LOCKS: Lock[] = [
  { id: "mutex", label: "Mutex", owner: "single" },
  { id: "serialQueue", label: "Serial queue", owner: "single" },
  { id: "dispatchSemaphore", label: "DispatchSemaphore", owner: "none" },
  { id: "pthreadReadWriteLock", label: "pthread_rwlock", owner: "multiple" },
  {
    id: "barrierQueueSyncWrite",
    label: "Concurrent queue, sync barrier",
    owner: "multiple",
  },
];

const EXPLANATION: Record<Owner, string> = {
  single:
    "A single known owner. While the main thread waits, the system lends its priority to the holder, and the holder finishes its work.",
  none: "No owner. The system can't tell which thread will call signal, so the holder keeps its background priority and waits for a free core.",
  multiple:
    "Multiple owners. The system doesn't pass the priority on, so the holder keeps its background priority and waits for a free core.",
};

/** Median main-thread wait in ms: iPhone 15 Pro Max, holder at background priority. */
const waits = (
  data.charts["inversion-wait"].data as unknown as Record<
    string,
    { values: Record<string, number[]> }
  >
)["background|iphone15"].values;

const DOMAIN = 75; // ms shown
const REQUEST_AT = 1; // the main thread asks for the lock 1 ms in
const FRAME = 1000 / 120;
const percent = (ms: number) => `${(ms / DOMAIN) * 100}%`;

class InversionTimeline extends HTMLElement {
  private lock = LOCKS[0];
  private cancel = () => {};
  private abort?: AbortController;
  private chart!: HTMLElement;
  private waiting!: HTMLElement;
  private resumed!: HTMLElement;
  private holding!: HTMLElement;
  private readout!: HTMLElement;
  private explanation!: HTMLElement;

  connectedCallback() {
    if (this.querySelector(".sb-figure")) return;
    this.abort = new AbortController();
    const description = fallbackText(this);

    const picker = segmented("Lock", LOCKS, this.lock.id, id => {
      this.lock = LOCKS.find(lock => lock.id === id)!;
      this.play();
    });
    const replay = el("button", {
      type: "button",
      class: "sb-button",
      text: "Replay",
    });
    replay.addEventListener("click", () => this.play());

    this.waiting = el("div", { class: "it-seg it-waiting" });
    this.resumed = el("div", { class: "it-seg it-running" });
    this.holding = el("div", { class: "it-seg it-holding" });
    const started = el("div", { class: "it-seg it-running" });
    started.style.width = percent(REQUEST_AT);
    const load = el("div", { class: "it-seg it-load" });
    load.style.width = "100%";

    const frames = () => {
      const layer = el("div", { class: "it-frames", "aria-hidden": "true" });
      for (let time = FRAME; time < DOMAIN; time += FRAME) {
        const line = el("span", { class: "it-frame" });
        line.style.left = percent(time);
        layer.append(line);
      }
      layer.append(el("span", { class: "it-playhead" }));
      return layer;
    };
    const axis = el("div", { class: "it-axis", "aria-hidden": "true" });
    for (let time = 0; time <= 70; time += 10) {
      const tick = el("span", {
        class: "it-tick",
        text: time === 0 ? "0" : `${time} ms`,
      });
      tick.style.left = percent(time);
      axis.append(tick);
    }

    const lane = (label: string, ...segments: HTMLElement[]) =>
      el(
        "div",
        { class: "it-lane" },
        el("div", { class: "it-lane-label", text: label }),
        el(
          "div",
          { class: "it-track" },
          el("div", { class: "it-reveal" }, ...segments),
          frames()
        )
      );

    const lastLane = lane("Six load threads", load);
    lastLane.querySelector(".it-track")!.append(axis);
    this.chart = el(
      "div",
      { class: "it-chart", role: "img", "aria-label": description },
      lane("Main thread", started, this.waiting, this.resumed),
      lane("Background thread", this.holding),
      lastLane
    );

    const legend = el(
      "div",
      { class: "sb-legend it-legend" },
      ...[
        ["it-running", "running"],
        ["it-waiting", "main thread waits for the lock"],
        ["it-holding", "holds the lock with the main thread's priority"],
        [
          "it-holding is-waiting-swatch",
          "holds the lock at background priority",
        ],
        ["it-load", "userInitiated load on all six cores"],
      ].map(([swatch, text]) =>
        el(
          "span",
          { class: "sb-legend-item" },
          el("span", { class: `sb-swatch ${swatch}` }),
          text
        )
      )
    );

    this.readout = el("p", { class: "it-readout", "aria-live": "off" });
    this.explanation = el("p", { class: "sb-detail" });
    const figure = el(
      "figure",
      { class: "sb-figure" },
      el("div", { class: "sb-controls" }, picker.node, replay),
      this.readout,
      this.chart,
      legend,
      this.explanation,
      el("figcaption", {
        class: "sb-caption",
        text: "Schematic: only the wait is measured. Median of three launches on the iPhone 15 Pro Max, holder at background priority. Dashed lines mark 120 Hz frames.",
      })
    );
    this.replaceChildren(figure);

    this.apply(0);
    onFirstVisible(this, () => this.play(), this.abort.signal);
  }

  disconnectedCallback() {
    this.abort?.abort();
    this.cancel();
  }

  private get wait(): number {
    return waits[this.lock.id][0];
  }

  private play() {
    this.cancel();
    const end = Math.min(DOMAIN, REQUEST_AT + this.wait + 6);
    this.cancel = tween(
      600 + end * 45,
      progress => this.apply(progress * end),
      t => t
    );
  }

  /** Draw the state at `now` ms. */
  private apply(now: number) {
    const { wait, lock } = this;
    const release = REQUEST_AT + wait;
    this.waiting.style.left = percent(REQUEST_AT);
    this.waiting.style.width = percent(wait);
    this.resumed.style.left = percent(release);
    this.resumed.style.width = percent(DOMAIN - release);
    this.holding.style.width = percent(release);
    this.holding.classList.toggle("is-boosted", lock.owner === "single");
    this.chart.style.setProperty("--now", percent(now));

    const waited = Math.max(0, Math.min(now - REQUEST_AT, wait));
    const done = now >= release;
    this.readout.replaceChildren(
      "Main thread ",
      done ? "waited " : "has waited ",
      el("strong", { text: `${formatValue(waited, 2)} ms` }),
      done ? `, ${formatValue(wait / FRAME, 1)} frames at 120 Hz` : ""
    );
    this.explanation.textContent = EXPLANATION[lock.owner];
  }
}

export function defineInversionTimeline() {
  if (!customElements.get("inversion-timeline"))
    customElements.define("inversion-timeline", InversionTimeline);
}
