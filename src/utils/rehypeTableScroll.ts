// Minimal hast shapes; the hast types are not a direct dependency.
interface Element {
  type: "element";
  tagName: string;
  properties?: Record<string, unknown>;
  children: Node[];
}
interface Node {
  type: string;
  value?: string;
}
interface Parent extends Node {
  children: Node[];
}

const isElement = (node: unknown, tag?: string): node is Element =>
  typeof node === "object" &&
  node !== null &&
  (node as Element).type === "element" &&
  (tag === undefined || (node as Element).tagName === tag);

const isScrollWrapper = (node: Parent) =>
  isElement(node, "div") && node.properties?.dataTableScroll !== undefined;

// Hand-written wrappers in Markdown reach this plugin as separate raw opening
// and closing tags around the table, not as a parent element.
const followsRawWrapper = (siblings: Node[], index: number) => {
  for (let i = index - 1; i >= 0; i--) {
    const node = siblings[i];
    if (node.type === "text" && !node.value?.trim()) continue;
    return (
      node.type === "raw" &&
      /<div\b[^>]*\bdata-table-scroll\b/.test(node.value ?? "")
    );
  }
  return false;
};

/**
 * Wraps every Markdown table in a `data-table-scroll` box, the wrapper that
 * research posts already write by hand, so a table wider than the column
 * scrolls sideways on a phone instead of squeezing its cells. Tables that
 * already sit in such a box are left alone.
 */
export default function rehypeTableScroll() {
  return (tree: Parent) => {
    const walk = (parent: Parent) => {
      parent.children.forEach((child, index) => {
        if (!isElement(child)) return;
        if (
          child.tagName === "table" &&
          !isScrollWrapper(parent) &&
          !followsRawWrapper(parent.children, index)
        ) {
          const box: Element = {
            type: "element",
            tagName: "div",
            properties: { dataTableScroll: "" },
            children: [child],
          };
          parent.children[index] = box;
          return;
        }
        walk(child);
      });
    };
    walk(tree);
  };
}
