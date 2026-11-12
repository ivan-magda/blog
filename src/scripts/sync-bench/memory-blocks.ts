import data from "./data.json";
import { el, fallbackText, onFirstVisible, segmented, tween } from "./util";

type Mechanism = { id: string; label: string; bytes: number; blocks: number };

/** Extra bytes and extra allocations per object, iPhone 15 Pro Max, 100,000 objects. */
const MECHANISMS = data.memory as Mechanism[];

const PITCH = 36;
const SIDE = 22;
const OBJECT_HEIGHT = 10;
const PX_PER_BYTE = 0.5;
const FLOAT_GAP = 9;
const MIN_ANGLE = -62;
const MAX_ANGLE = -22;
const REST_ANGLE = -40;
const COUNTS = [
  { id: "1000", label: "1,000" },
  { id: "10000", label: "10,000" },
  { id: "100000", label: "100,000" },
];

function formatBytes(bytes: number): string {
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(1).replace(/\.0$/, "")} MB`;
  if (bytes >= 1e3) return `${(bytes / 1e3).toFixed(0)} KB`;
  return `${bytes} bytes`;
}

/** A box built from five faces in the scene's floor coordinates (z points up). */
function box(
  kind: string,
  x: number,
  y: number,
  z: number,
  width: number,
  depth: number,
  height: number
): HTMLElement[] {
  const top = z + height;
  const face = (
    name: string,
    w: number,
    h: number,
    transform: string
  ): HTMLElement => {
    const node = el("span", { class: `mb-face mb-${name} mb-${kind}` });
    node.style.width = `${w}px`;
    node.style.height = `${h}px`;
    node.style.transform = transform;
    return node;
  };
  const wall = "rotateX(-90deg)";
  const side = "rotateZ(90deg) rotateX(-90deg)";
  return [
    face("top", width, depth, `translate3d(${x}px, ${y}px, ${top}px)`),
    face(
      "wall",
      width,
      height,
      `translate3d(${x}px, ${y}px, ${top}px) ${wall}`
    ),
    face(
      "wall",
      width,
      height,
      `translate3d(${x}px, ${y + depth}px, ${top}px) ${wall}`
    ),
    face(
      "side",
      depth,
      height,
      `translate3d(${x}px, ${y}px, ${top}px) ${side}`
    ),
    face(
      "side",
      depth,
      height,
      `translate3d(${x + width}px, ${y}px, ${top}px) ${side}`
    ),
  ];
}

class MemoryBlocks extends HTMLElement {
  private selected = MECHANISMS.find(item => item.id === "mutex")!;
  private count = 100000;
  private angle = REST_ANGLE;
  private cancel = () => {};
  private abort?: AbortController;
  private observer?: ResizeObserver;
  private scene!: HTMLElement;
  private world!: HTMLElement;
  private towers = new Map<string, HTMLElement>();
  private chips = new Map<string, HTMLElement>();
  private detail!: HTMLElement;
  private slider!: HTMLInputElement;

  connectedCallback() {
    if (this.querySelector(".sb-figure")) return;
    this.abort = new AbortController();
    const { signal } = this.abort;
    const description = fallbackText(this);

    this.world = el("div", { class: "mb-world" });
    const origin = -((MECHANISMS.length - 1) * PITCH + SIDE) / 2;
    MECHANISMS.forEach((item, index) => {
      const x = origin + index * PITCH;
      const y = -SIDE / 2;
      const tower = el("div", { class: "mb-tower" });
      tower.append(...box("object", x, y, 0, SIDE, SIDE, OBJECT_HEIGHT));
      const extra = item.bytes * PX_PER_BYTE;
      if (item.bytes > 0 && item.blocks === 0) {
        tower.append(...box("inline", x, y, OBJECT_HEIGHT, SIDE, SIDE, extra));
      } else if (item.bytes > 0) {
        const part = extra / item.blocks;
        for (let block = 0; block < item.blocks; block++) {
          const z = OBJECT_HEIGHT + FLOAT_GAP + block * (part + FLOAT_GAP);
          tower.append(...box("separate", x, y, z, SIDE, SIDE, part));
        }
      }
      tower.addEventListener("pointerenter", () => this.select(item));
      tower.addEventListener("click", () => this.select(item));
      this.towers.set(item.id, tower);
      this.world.append(tower);
    });

    this.scene = el(
      "div",
      { class: "mb-scene", role: "img", "aria-label": description },
      this.world
    );
    let dragFrom: { x: number; angle: number } | null = null;
    this.scene.addEventListener("pointerdown", event => {
      dragFrom = { x: event.clientX, angle: this.angle };
      this.cancel();
    });
    window.addEventListener(
      "pointermove",
      event => {
        if (dragFrom)
          this.setAngle(dragFrom.angle + (event.clientX - dragFrom.x) * 0.35);
      },
      { signal }
    );
    window.addEventListener("pointerup", () => (dragFrom = null), { signal });

    this.slider = el("input", {
      type: "range",
      class: "mb-slider",
      min: MIN_ANGLE,
      max: MAX_ANGLE,
      step: 1,
      value: REST_ANGLE,
      "aria-label": "View angle",
    });
    this.slider.addEventListener("input", () => {
      this.cancel();
      this.setAngle(Number(this.slider.value));
    });

    const counts = segmented("Objects", COUNTS, String(this.count), id => {
      this.count = Number(id);
      this.select(this.selected);
    });

    const chips = el("div", { class: "mb-chips" });
    for (const item of MECHANISMS) {
      const chip = el("button", {
        type: "button",
        class: "sb-button mb-chip",
        "aria-pressed": "false",
        text: `${item.label} +${item.bytes}`,
      });
      chip.addEventListener("click", () => this.select(item));
      chip.addEventListener("pointerenter", () => this.select(item));
      this.chips.set(item.id, chip);
      chips.append(chip);
    }

    const legend = el(
      "div",
      { class: "sb-legend" },
      ...[
        ["mb-object", "the object"],
        ["mb-inline", "extra bytes inside the object"],
        ["mb-separate", "a separate allocation"],
      ].map(([swatch, text]) =>
        el(
          "span",
          { class: "sb-legend-item" },
          el("span", { class: `sb-swatch ${swatch}` }),
          text
        )
      )
    );

    this.detail = el("p", { class: "sb-detail", "aria-live": "polite" });
    const figure = el(
      "figure",
      { class: "sb-figure" },
      el(
        "div",
        { class: "sb-controls" },
        counts.node,
        el(
          "label",
          { class: "sb-seg mb-angle" },
          el("span", { class: "sb-seg-label", text: "Rotate" }),
          this.slider
        )
      ),
      legend,
      this.scene,
      chips,
      this.detail,
      el("figcaption", {
        class: "sb-caption",
        text: "Height shows extra bytes per object, ordered from 0 to 240. Where a mechanism takes two allocations, the split between them isn't measured and is drawn evenly. iPhone 15 Pro Max, 100,000 objects, median of 12 launches.",
      })
    );
    this.replaceChildren(figure);

    this.observer = new ResizeObserver(([entry]) => {
      const scale = Math.min(1, entry.contentRect.width / 640);
      this.scene.style.setProperty("--mb-scale", String(scale));
      this.scene.style.height = `${Math.round(120 + 200 * scale)}px`;
    });
    this.observer.observe(this.scene);

    this.select(this.selected);
    this.setAngle(REST_ANGLE);
    onFirstVisible(
      this,
      () => {
        this.cancel = tween(1400, progress =>
          this.setAngle(MIN_ANGLE + (REST_ANGLE - MIN_ANGLE) * progress)
        );
      },
      signal
    );
  }

  disconnectedCallback() {
    this.abort?.abort();
    this.observer?.disconnect();
    this.cancel();
  }

  private setAngle(angle: number) {
    this.angle = Math.max(MIN_ANGLE, Math.min(MAX_ANGLE, angle));
    this.world.style.setProperty("--mb-angle", `${this.angle}deg`);
    this.slider.value = String(Math.round(this.angle));
  }

  private select(item: Mechanism) {
    this.selected = item;
    for (const [id, tower] of this.towers)
      tower.classList.toggle("is-selected", id === item.id);
    for (const [id, chip] of this.chips)
      chip.setAttribute("aria-pressed", String(id === item.id));
    const where =
      item.bytes === 0
        ? "adds nothing to the object"
        : item.blocks === 0
          ? `adds ${item.bytes} bytes inside the object, with no extra allocation`
          : `adds ${item.bytes} bytes in ${item.blocks === 1 ? "one separate allocation" : `${item.blocks} separate allocations`}`;
    const total =
      item.bytes === 0
        ? ""
        : ` For ${this.count.toLocaleString("en-US")} objects that comes to ${formatBytes(item.bytes * this.count)}.`;
    this.detail.textContent = `${item.label} ${where}.${total}`;
  }
}

export function defineMemoryBlocks() {
  if (!customElements.get("memory-blocks"))
    customElements.define("memory-blocks", MemoryBlocks);
}
