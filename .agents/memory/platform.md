# Platform and maintenance

Reviewed against repository code on 2026-10-05.

## Framework and SEO

Read [root guidance](../../CLAUDE.md) for commands and critical gotchas, and
[SEO reference](../../docs/seo.md) for metadata, sitemap, RSS, and canonical handling.
The current [package manifest](../../package.json) uses Astro 7 with the existing
AstroPaper 5.5.1-derived template. The earlier plan to replace it with AstroPaper v6
was dropped in favor of an in-place framework upgrade; optional template features
are separate decisions.

[Astro configuration](../../astro.config.ts) retains `compressHTML: true` to preserve
inline whitespace. Current fonts use WOFF2 with `latin`, `symbols`, and `symbols2`
subsets. The old note requiring both WOFF2 and WOFF is superseded by this code.
Keep font changes coordinated across configuration, layout, and global CSS.

Tag pages are noindexed and excluded from the sitemap. New posts need reviewed
cross-links and an entry in `public/llms.txt`. Old Search Console/Bing submission
counts and predictions of indexing dates are historical; check the services before
claiming current indexing or requesting indexing actions.

## Table of contents

[TableOfContents.astro](../../src/components/TableOfContents.astro) implements a
vanilla JavaScript/CSS desktop tick rail, shown from 1280px. It expands on hover or
focus, wraps long labels, and uses uniform tick spacing and native anchor links.
[PostDetails.astro](../../src/layouts/PostDetails.astro) supplies h2/h3 headings and
renders the rail when at least three are present. A mobile sheet is not implemented.

Current scroll-spy derives the active heading from geometry, throttled with
`requestAnimationFrame`, with a bottom-of-page fallback and `ResizeObserver` for
reflow. The old IntersectionObserver/sentinel design is obsolete. AbortController
cleanup handles page transitions, including disconnecting the resize observer.
Preserve keyboard dismissal, focus recovery, `data-pagefind-ignore`, and the
reduced-motion override in [global CSS](../../src/styles/global.css).

## ASCII file trees

[AsciiFileTree.astro](../../src/components/AsciiFileTree.astro) enhances Markdown
code fences wrapped in `<ascii-file-tree data-highlight="MEMORY.md">`. The project
memory post uses this for a single reveal on entering the viewport, followed by
an index-file highlight. The full text remains in the HTML; Replay and Copy are
progressive enhancements. Preserve reduced-motion handling, offscreen pauses,
reserved control space, and custom-element disconnect cleanup for Astro navigation.
The generic copy-button code in `PostDetails.astro` skips these blocks.

## Reading analytics

[The tracker](../../src/scripts/reading-tracker.ts) and its post-layout integration
are present. [The Umami recipe](../../docs/blog-analytics-umami-recipe.md) is the
maintained reference for event names, active-time analysis, debugging, and the
approximate read-velocity gate. Use native funnels; a custom analytics dashboard
was deferred and should receive a separate specification if pursued.

The old note listed real-device iOS Safari event delivery as pending. This
migration did not perform that check or inspect live analytics; verify `pagehide`
delivery on a real device before treating that historical gate as complete. Old
pull-request status and past automated QA results are not current verification.
