/**
 * Ordered series of posts, by post slug (the entry id).
 * Kept here instead of in frontmatter so that grouping posts into a series
 * never touches an article file. A post belongs to at most one series.
 */
export type Series = {
  title: string;
  /**
   * When set, the series gets an indexable hub page at `/series/<slug>/`
   * (src/pages/series/[series].astro) listing every part in order.
   */
  slug?: string;
  /** Hub page intro and meta description. Required when `slug` is set. */
  description?: string;
  slugs: string[];
};

export const SERIES: Series[] = [
  {
    title: "Building a Coding Agent in Swift",
    slug: "swift-coding-agent",
    description:
      "Build a Claude Code-style CLI coding agent in Swift over nine posts: project setup, the agent loop, tool dispatch, task tracking, subagents, skill loading, context compaction, a task DAG, and background tasks.",
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

/** Link to a series hub page, or undefined when the series has none. */
export const seriesPath = (series: Series) =>
  series.slug ? `/series/${series.slug}/` : undefined;
