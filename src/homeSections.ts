import { SERIES } from "@/series";

/**
 * Sections of the home page index, by post slug (the entry id).
 * Posts show in the listed order; a series reuses its order from
 * `src/series.ts`. Sections are ordered by their newest post, so the section
 * holding the latest article comes first. Hidden posts (draft, hideFromFeed,
 * scheduled) are skipped. Posts in no section land in "More posts", so a new
 * article always appears without editing this file.
 */
export type HomeSection = {
  title: string;
  description: string;
  /** Number the posts as parts, in the given order. */
  numbered?: boolean;
  slugs: string[];
};

const series = (title: string) => {
  const found = SERIES.find(s => s.title === title);
  if (!found) throw new Error(`Unknown series: ${title}`);
  return found.slugs;
};

export const HOME_SECTIONS: HomeSection[] = [
  {
    title: "Swift performance, measured",
    description:
      "Benchmarks and investigations run on physical iPhones: where the time goes in synchronization and concurrency code.",
    slugs: [
      "swift-synchronization-benchmarks",
      "swift-debounce-runtime-investigation",
    ],
  },
  {
    title: "Working with AI coding agents",
    description:
      "Context files, shared project memory, agent UI, and what a framework gives you after building an agent by hand.",
    slugs: [
      "project-memory-in-the-repository",
      "telegram-native-agent-progress",
      "koog-s01-foundation",
      "five-things-ai-coding-agents-actually-work",
      "fixing-40k-claude-md-warning-monorepo",
    ],
  },
  {
    title: "WWDC26: Foundation Models Framework",
    description:
      "The WWDC26 Foundation Models announcements: an overview and two deep dives.",
    slugs: series("WWDC26: Foundation Models Framework"),
  },
  {
    title: "Building a Coding Agent in Swift",
    description:
      "A nine-part series: a Swift reimplementation of a Claude Code-style CLI agent, built stage by stage.",
    numbered: true,
    slugs: series("Building a Coding Agent in Swift"),
  },
];

export const MORE_POSTS_TITLE = "More posts";
