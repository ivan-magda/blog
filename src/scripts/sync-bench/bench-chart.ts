import data from "./data.json";
import {
  displayed,
  el,
  fallbackText,
  formatValue,
  onFirstVisible,
  reducedMotion,
  segmented,
  type Option,
} from "./util";

type Triple = [median: number, minimum: number, maximum: number];
type Cell = {
  n: number | string;
  values: Record<string, Triple | Record<string, Triple>>;
};
type ChartSpec = {
  axis: string;
  unit: string;
  better: "lower" | "higher";
  sort: "asc" | "desc" | "none";
  baseline: string | null;
  baselineLabel?: string;
  conditions: string;
  digits?: number;
  controls?: { key: string; label: string; options: Option[] }[];
  extra?: { label: string; rows: string[] };
  series?: Option[];
  rows: Option[];
  data: Record<string, Cell>;
};

const charts = data.charts as unknown as Record<string, ChartSpec>;
const phones = data.phones as Record<string, { name: string; ios: string }>;
const PHONE_OPTIONS: Option[] = [
  { id: "iphone15", label: "iPhone 15" },
  { id: "iphone11", label: "iPhone 11" },
];
const PHONE_EVENT = "syncbench:phone";
const HIGHLIGHT = new Set(["mutex", "oneLock"]);

/** One phone choice for every chart on the page. */
let currentPhone = "iphone15";

type RowNode = {
  id: string;
  label: string;
  node: HTMLElement;
  bars: { bar: HTMLElement; value: HTMLElement }[];
};

/** Round an axis maximum up to a 1, 2, 2.5 or 5 step and return the tick values. */
function ticksFor(max: number): number[] {
  if (!(max > 0)) return [0, 1];
  const rough = max / 5;
  const power = 10 ** Math.floor(Math.log10(rough));
  const step =
    [1, 2, 2.5, 5, 10].map(m => m * power).find(s => s >= rough) ?? rough;
  const count = Math.ceil(max / step - 1e-9);
  return Array.from({ length: count + 1 }, (_, index) =>
    Number((index * step).toPrecision(10))
  );
}

function formatRatio(ratio: number): string {
  if (ratio >= 10) return ratio.toFixed(0);
  if (ratio >= 0.1) return ratio.toFixed(1);
  return ratio.toFixed(2);
}

class BenchChart extends HTMLElement {
  private spec!: ChartSpec;
  private state: Record<string, string> = {};
  private showExtra = false;
  private revealed = false;
  private rowNodes: RowNode[] = [];
  private rowsBox!: HTMLElement;
  private grid!: HTMLElement;
  private detail!: HTMLElement;
  private caption!: HTMLElement;
  private phoneControl!: ReturnType<typeof segmented>;
  private abort?: AbortController;

  connectedCallback() {
    const spec = charts[this.getAttribute("chart") ?? ""];
    if (!spec || this.querySelector(".sb-figure")) return;
    this.spec = spec;
    this.abort = new AbortController();
    const { signal } = this.abort;
    const description = fallbackText(this);

    const controls = el("div", { class: "sb-controls" });
    for (const control of spec.controls ?? []) {
      this.state[control.key] = control.options[0].id;
      controls.append(
        segmented(control.label, control.options, control.options[0].id, id => {
          this.state[control.key] = id;
          this.update(true);
        }).node
      );
    }
    this.phoneControl = segmented("Phone", PHONE_OPTIONS, currentPhone, id => {
      currentPhone = id;
      document.dispatchEvent(new CustomEvent(PHONE_EVENT));
    });
    controls.append(this.phoneControl.node);
    if (spec.extra) {
      const toggle = el("button", {
        type: "button",
        class: "sb-toggle",
        "aria-pressed": "false",
        text: spec.extra.label,
      });
      toggle.addEventListener("click", () => {
        this.showExtra = !this.showExtra;
        toggle.setAttribute("aria-pressed", String(this.showExtra));
        this.update(true);
      });
      controls.append(toggle);
    }

    const legend = spec.series
      ? el(
          "div",
          { class: "sb-legend" },
          ...spec.series.map((series, index) =>
            el(
              "span",
              { class: "sb-legend-item" },
              el("span", { class: `sb-swatch sb-series-${index}` }),
              series.label
            )
          )
        )
      : null;

    this.grid = el("div", { class: "sb-grid", "aria-hidden": "true" });
    this.rowsBox = el("div", { class: "sb-rows" });
    this.rowNodes = spec.rows.map(row => this.buildRow(row));
    const plot = el(
      "div",
      { class: "sb-plot", role: "img", "aria-label": description },
      this.grid,
      this.rowsBox
    );
    plot.addEventListener("pointerleave", () => this.showDetail(null));

    this.detail = el("p", { class: "sb-detail", "aria-live": "polite" });
    this.caption = el("figcaption", { class: "sb-caption" });
    const figure = el(
      "figure",
      { class: "sb-figure" + (spec.series ? " sb-multi" : "") },
      controls
    );
    if (legend) figure.append(legend);
    figure.append(
      plot,
      el("p", { class: "sb-axis-title", text: spec.axis }),
      this.detail,
      this.caption
    );
    this.replaceChildren(figure);

    document.addEventListener(
      PHONE_EVENT,
      () => {
        this.phoneControl.set(currentPhone);
        this.update(true);
      },
      { signal }
    );

    this.update(false);
    if (reducedMotion()) this.reveal();
    else onFirstVisible(this, () => this.reveal(), signal);
  }

  disconnectedCallback() {
    this.abort?.abort();
  }

  private buildRow(row: Option): RowNode {
    const track = el("div", { class: "sb-track" });
    const bars = (this.spec.series ?? [null]).map((_, index) => {
      const bar = el("div", { class: `sb-bar sb-series-${index}` });
      const value = el("span", { class: "sb-value" });
      track.append(el("div", { class: "sb-barline" }, bar, value));
      return { bar, value };
    });
    const node = el(
      "div",
      { class: "sb-row" + (HIGHLIGHT.has(row.id) ? " is-baseline" : "") },
      el("div", { class: "sb-label", text: row.label }),
      track
    );
    const entry: RowNode = { id: row.id, label: row.label, node, bars };
    node.addEventListener("pointerenter", () => this.showDetail(entry));
    node.addEventListener("click", () => this.showDetail(entry));
    return entry;
  }

  private cell(): Cell {
    const keys = (this.spec.controls ?? []).map(c => this.state[c.key]);
    return this.spec.data[[...keys, currentPhone].join("|")];
  }

  /** Values of one row in series order. */
  private valuesOf(cell: Cell, id: string): Triple[] {
    const entry = cell.values[id];
    if (Array.isArray(entry)) return [entry];
    return (this.spec.series ?? []).map(series => entry[series.id]);
  }

  private reveal() {
    this.revealed = true;
    this.update(false);
  }

  private update(animate: boolean) {
    const { spec } = this;
    const cell = this.cell();
    const hidden = new Set(this.showExtra ? [] : (spec.extra?.rows ?? []));
    const visible = this.rowNodes.filter(row => !hidden.has(row.id));
    const medians = (row: RowNode) =>
      this.valuesOf(cell, row.id).map(t => t[0]);
    const ticks = ticksFor(Math.max(...visible.flatMap(medians)));
    const axisMax = ticks[ticks.length - 1];

    const before = new Map(
      this.rowNodes.map(row => [row, row.node.getBoundingClientRect().top])
    );
    const wasHidden = new Set(this.rowNodes.filter(row => row.node.hidden));

    const ordered = [...visible];
    if (spec.sort !== "none") {
      const direction = spec.sort === "asc" ? 1 : -1;
      const position = new Map(this.rowNodes.map((row, index) => [row, index]));
      const shown = (row: RowNode) => displayed(medians(row)[0], spec.digits);
      ordered.sort(
        (a, b) =>
          direction * (shown(a) - shown(b)) ||
          position.get(a)! - position.get(b)!
      );
    }
    for (const row of this.rowNodes) row.node.hidden = hidden.has(row.id);
    this.rowsBox.replaceChildren(...ordered.map(row => row.node));

    for (const row of visible) {
      medians(row).forEach((median, index) => {
        const { bar, value } = row.bars[index];
        const fraction = this.revealed ? median / axisMax : 0;
        bar.style.setProperty("--f", String(fraction));
        value.textContent = formatValue(median, spec.digits);
      });
    }

    this.grid.replaceChildren(
      ...ticks.map(tick => {
        const line = el("span", { class: "sb-tick" });
        line.style.setProperty("--f", String(tick / axisMax));
        line.append(
          el("span", {
            class: "sb-tick-label",
            text: tick.toLocaleString("en-US"),
          })
        );
        return line;
      })
    );

    if (animate && !reducedMotion()) {
      for (const row of visible) {
        const shift = before.get(row)! - row.node.getBoundingClientRect().top;
        if (wasHidden.has(row)) {
          row.node.animate([{ opacity: 0 }, { opacity: 1 }], {
            duration: 500,
            easing: "ease-out",
          });
        } else if (Math.abs(shift) > 0.5) {
          row.node.animate(
            [{ transform: `translateY(${shift}px)` }, { transform: "none" }],
            { duration: 550, easing: "cubic-bezier(0.2, 0.7, 0.2, 1)" }
          );
        }
      }
    }

    const phone = phones[currentPhone];
    this.caption.textContent = `${spec.conditions}. ${phone.name}, iOS ${phone.ios}, Release build. Median of ${cell.n} launches.`;
    this.showDetail(null);
  }

  private showDetail(row: RowNode | null) {
    const { spec } = this;
    for (const other of this.rowNodes)
      other.node.classList.toggle("is-active", other === row);
    if (!row) {
      const hint =
        spec.better === "lower"
          ? "Shorter bars are better."
          : "Longer bars are better.";
      const verb = window.matchMedia("(hover: none)").matches
        ? "Tap"
        : "Point at";
      this.detail.textContent = `${hint} ${verb} a row for details.`;
      return;
    }
    const cell = this.cell();
    const values = this.valuesOf(cell, row.id);
    const format = (value: number) => formatValue(value, spec.digits);
    if (spec.series) {
      const parts = spec.series.map(
        (series, index) =>
          `${format(values[index][0])} with ${series.label.toLowerCase()}`
      );
      this.detail.textContent = `${row.label}: ${parts.join(", ")} (${spec.unit}).`;
      return;
    }
    const [median, minimum, maximum] = values[0];
    let text = `${row.label}: ${format(median)} ${spec.unit}`;
    const baseline = spec.baseline ? cell.values[spec.baseline] : undefined;
    if (
      spec.baseline &&
      row.id !== spec.baseline &&
      Array.isArray(baseline) &&
      baseline[0] > 0
    ) {
      const name =
        spec.baselineLabel ??
        spec.rows.find(r => r.id === spec.baseline)?.label ??
        "the baseline";
      text += `, ${formatRatio(median / baseline[0])}× ${name}`;
    }
    text += `. Launches ranged from ${format(minimum)} to ${format(maximum)}.`;
    this.detail.textContent = text;
  }
}

export function defineBenchChart() {
  if (!customElements.get("bench-chart"))
    customElements.define("bench-chart", BenchChart);
}
