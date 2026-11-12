import { el, fallbackText, onFirstVisible, segmented, tween } from "./util";

type Kind = "run" | "switch" | "batch";
type Segment = { lane: number; from: number; to: number; kind: Kind };
type Scenario = {
  id: string;
  label: string;
  cost: string;
  costNs: number;
  duration: number;
  note: string;
  segments: Segment[];
  /** Hops between a lane and the lane below it, at a horizontal position in percent. */
  hops: { lane: number; at: number }[];
};

const LANES = ["Main thread", "CounterActor", "Background task"];
const MAIN = 0;
const ACTOR = 1;
const TASK = 2;

function alternating(first: number, calls: number): Scenario["segments"] {
  const segments: Segment[] = [];
  const width = 92 / (calls * 2 + 1);
  for (let index = 0; index <= calls * 2; index++) {
    segments.push({
      lane: index % 2 === 0 ? first : ACTOR,
      from: 4 + index * width,
      to: 4 + (index + 1) * width,
      kind: "run",
    });
  }
  return segments;
}

const fromBackground = alternating(TASK, 5);
const SCENARIOS: Scenario[] = [
  {
    id: "background",
    label: "From a background task",
    cost: "52.6 ns per call",
    costNs: 52.61,
    duration: 2400,
    note: "Every await suspends the task, runs the increment on the actor, and resumes the task. The main thread isn't involved.",
    segments: fromBackground,
    hops: fromBackground
      .slice(1)
      .map(segment => ({ lane: ACTOR, at: segment.from })),
  },
  {
    id: "mainActor",
    label: "From MainActor",
    cost: "4.89 µs per call",
    costNs: 4890.73,
    duration: 5200,
    note: "Every await leaves the main thread for the actor and comes back. The two thread switches take almost all of the 4.89 µs.",
    segments: [
      { lane: MAIN, from: 3, to: 9, kind: "run" },
      { lane: ACTOR, from: 9, to: 25, kind: "switch" },
      { lane: ACTOR, from: 25, to: 29, kind: "run" },
      { lane: MAIN, from: 29, to: 45, kind: "switch" },
      { lane: MAIN, from: 45, to: 51, kind: "run" },
      { lane: ACTOR, from: 51, to: 67, kind: "switch" },
      { lane: ACTOR, from: 67, to: 71, kind: "run" },
      { lane: MAIN, from: 71, to: 87, kind: "switch" },
      { lane: MAIN, from: 87, to: 95, kind: "run" },
    ],
    hops: [9, 29, 51, 71].map(at => ({ lane: MAIN, at })),
  },
  {
    id: "batch",
    label: "One await, 100 updates",
    cost: "1.23 ns per update",
    costNs: 1.227,
    duration: 2000,
    note: "One await hands the actor a hundred updates. The cost of the call is paid once: 123 ns for the whole batch.",
    segments: [
      { lane: TASK, from: 4, to: 14, kind: "run" },
      { lane: ACTOR, from: 14, to: 82, kind: "batch" },
      { lane: TASK, from: 82, to: 94, kind: "run" },
    ],
    hops: [14, 82].map(at => ({ lane: ACTOR, at })),
  },
];

class ActorHops extends HTMLElement {
  private scenario = SCENARIOS[0];
  private cancel = () => {};
  private abort?: AbortController;
  private chart!: HTMLElement;
  private reveals: HTMLElement[] = [];
  private note!: HTMLElement;
  private costRows: HTMLElement[] = [];

  connectedCallback() {
    if (this.querySelector(".sb-figure")) return;
    this.abort = new AbortController();
    const description = fallbackText(this);

    const picker = segmented(
      "Call",
      SCENARIOS.map(({ id, label }) => ({ id, label })),
      this.scenario.id,
      id => {
        this.scenario = SCENARIOS.find(scenario => scenario.id === id)!;
        this.build();
        this.play();
      }
    );
    const replay = el("button", {
      type: "button",
      class: "sb-button",
      text: "Replay",
    });
    replay.addEventListener("click", () => this.play());

    this.reveals = LANES.map(() => el("div", { class: "it-reveal ah-reveal" }));
    this.chart = el(
      "div",
      { class: "it-chart ah-chart", role: "img", "aria-label": description },
      ...LANES.map((label, index) =>
        el(
          "div",
          { class: "it-lane" },
          el("div", { class: "it-lane-label", text: label }),
          el("div", { class: "it-track" }, this.reveals[index])
        )
      )
    );

    const maxCost = Math.max(...SCENARIOS.map(scenario => scenario.costNs));
    this.costRows = SCENARIOS.map(scenario => {
      const bar = el("div", { class: "sb-bar" });
      bar.style.setProperty("--f", String(scenario.costNs / maxCost));
      return el(
        "div",
        { class: "sb-row" },
        el("div", { class: "sb-label", text: scenario.label }),
        el(
          "div",
          { class: "sb-track" },
          el(
            "div",
            { class: "sb-barline" },
            bar,
            el("span", { class: "sb-value", text: scenario.cost })
          )
        )
      );
    });

    const legend = el(
      "div",
      { class: "sb-legend it-legend" },
      ...[
        ["it-running", "running"],
        ["it-waiting", "switching threads"],
        ["ah-batch", "a hundred updates in one call"],
      ].map(([swatch, text]) =>
        el(
          "span",
          { class: "sb-legend-item" },
          el("span", { class: `sb-swatch ${swatch}` }),
          text
        )
      )
    );

    this.note = el("p", { class: "sb-detail" });
    const figure = el(
      "figure",
      { class: "sb-figure ah-figure" },
      el("div", { class: "sb-controls" }, picker.node, replay),
      this.chart,
      legend,
      this.note,
      el("p", {
        class: "ah-title",
        text: "Measured cost of one counter update",
      }),
      el("div", { class: "sb-rows ah-costs" }, ...this.costRows),
      el("figcaption", {
        class: "sb-caption",
        text: "The timeline is a schematic and isn't to scale; the bars are. iPhone 15 Pro Max, iOS 26.6.2, Release build.",
      })
    );
    this.replaceChildren(figure);

    this.build();
    this.chart.style.setProperty("--now", "0%");
    onFirstVisible(this, () => this.play(), this.abort.signal);
  }

  disconnectedCallback() {
    this.abort?.abort();
    this.cancel();
  }

  private build() {
    const { scenario } = this;
    this.reveals.forEach(reveal => reveal.replaceChildren());
    for (const segment of scenario.segments) {
      const node = el("div", {
        class:
          "it-seg " +
          { run: "it-running", switch: "it-waiting", batch: "ah-batch" }[
            segment.kind
          ],
      });
      node.style.left = `${segment.from}%`;
      node.style.width = `${segment.to - segment.from}%`;
      this.reveals[segment.lane].append(node);
    }
    for (const hop of scenario.hops) {
      const node = el("span", { class: "ah-hop" });
      node.style.left = `${hop.at}%`;
      this.reveals[hop.lane].append(node);
    }
    this.note.textContent = scenario.note;
    this.costRows.forEach((row, index) =>
      row.classList.toggle("is-baseline", SCENARIOS[index] === scenario)
    );
  }

  private play() {
    this.cancel();
    this.cancel = tween(
      this.scenario.duration,
      progress => this.chart.style.setProperty("--now", `${progress * 100}%`),
      t => t
    );
  }
}

export function defineActorHops() {
  if (!customElements.get("actor-hops"))
    customElements.define("actor-hops", ActorHops);
}
