/**
 * Ordered series of posts, by post slug (the entry id).
 * Kept here instead of in frontmatter so that grouping posts into a series
 * never touches an article file. A post belongs to at most one series.
 */
export type Series = {
  title: string;
  /** Page listing the whole series, when one exists. */
  href?: string;
  slugs: string[];
};

export const SERIES: Series[] = [
  {
    title: "Building a Coding Agent in Swift",
    href: "/tags/swift-claude-code/",
    slugs: [
      "s00-bootstrapping-the-project",
      "s01-the-agent-loop",
      "s02-tool-dispatch",
      "s03-self-managed-task-tracking",
      "s04-subagents",
      "s05-skill-loading",
      "s06-context-compaction",
      "s07-task-system",
      "s08-background-tasks",
    ],
  },
  {
    title: "WWDC26: Foundation Models Framework",
    slugs: [
      "wwdc26-foundation-models-year-two",
      "foundation-models-private-cloud-compute",
      "foundation-models-dynamic-profiles",
    ],
  },
];
