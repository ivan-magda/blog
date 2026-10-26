# Editorial workflow

## Writing and review preferences

- For Russian drafting, adaptation, editing and figure labels, read the shared
  [Russian technical writing guide](../../docs/russian-writing.md). It owns the
  author-approved English-term policy, semantic distinctions, natural Russian
  overrides, е spelling and current/proposed approval workflow. Pass it to
  delegated authors and reviewers rather than reconstructing rules from memory.

- Write repository artifacts, specifications, plans, skills, and research reports
  in English. Match the user's language in conversation.
- Resolve publication destination and article language separately when starting a
  new post. Ivan usually writes for `https://ivanmagda.dev`; suggest English for
  that destination, but ask for missing inputs instead of inferring them from a
  Russian conversation or source materials. Reuse explicit session answers. The
  [writing skill](../skills/writing-blog-post/SKILL.md) carries these choices into
  the direction, drafts, and visuals.
- Blog drafting is editorial work. Once the angle and outline are agreed, write
  directly instead of adding the code-development specification and implementation
  ceremony. The established [writing skill](../skills/writing-blog-post/SKILL.md)
  supplies its own research and outline workflow; use it when applicable.
- Verify review findings against the actual text, code, or primary documentation
  before reporting them. Include useful locations and evidence. Treat findings from
  another reviewer as claims to check.
- Preserve the author's intended content and voice. Correctness, grammar, and
  attribution fixes may be within an authorized edit, but cuts, added explanations,
  personality lines, and internal-link choices remain the author's decisions. Keep
  edit batches small and inspect the body diff. Follow the
  [draft-review skill](../skills/reviewing-blog-draft/SKILL.md) for prepublication
  reviews, taking the current user's authorized edit scope into account.
- Prioritize natural, lively English and a readable investigation over exhaustive
  micro-editing. Keep material measurement limits, but consolidate repeated
  caveats and editorial process language so they do not interrupt the story.
- Run `stop-slop` as a separate editing pass, not just an intention while drafting.
  Prefer the established house voice when style advice conflicts, while applying
  the explicit preference below.
- Reduce em dashes in prose using periods, colons, or commas; existing heavy use is
  not evidence of the desired voice. Avoid em dashes in titles.
- Introduce algorithms with concise source-based examples; omit benchmark
  counters unless the passage explains measurement. Briefly identify omissions
  and link the complete measured implementation.
- For a long headline on a single post, prefer a shorter frontmatter `ogTitle`
  for social previews instead of changing shared OG typography. The generated
  card and OG/Twitter metadata should use the same override, with `title` as fallback.
- Make code listings readable as teaching examples: use descriptive local names,
  separate nested operations, expand dense control flow, and group related steps
  with whitespace. Preserve source APIs, behavior, and exact profiler symbols;
  mention adaptations once instead of repeating editorial caveats.
- For research-heavy technical posts, prioritize complete explanations of
  non-obvious findings over fitting an arbitrary word count. Ivan explicitly
  values plentiful visualizations, charts, diagrams, and real code that make the
  reasoning easier to follow. Inventory and reuse relevant repository artifacts;
  plan figures alongside the explanation rather than imposing a small quota.
- Match technical figures to the blog or use restrained scientific-publication
  conventions. Avoid generic infographic cards, oversized internal headlines,
  decorative banners, and arbitrary multicolour palettes. Prefer labelled axes,
  units, direct values, useful observed variability, and clear engineering lines.
  Keep figure blocks visually distinct from surrounding prose with a thin border
  and a subtly contrasting background; seamless page-colour figures felt unbounded.
  Integrate both light and dark themes. Diagram Design is available locally when
  useful; adapt its defaults to the destination instead of applying its stock skin.
- Make important metric comparisons visible as charts instead of relying on
  tables alone. Retain exact numbers in a nearby `View data` disclosure. Check
  figure labels at mobile reading width; provide a separate mobile composition
  when shrinking the desktop chart makes its labels too small.

When the author requests independent editorial alternatives, create a separate
chat/context for every variant, including different lengths. Native Codex drafts
remain part of the comparison alongside any requested ChatGPT/Claude web drafts;
an after-the-fact synthesis is not an independent Codex version. Preserve the
first responses and keep corrections separate. For independent second opinions
from Claude and ChatGPT, start a new chat for each reviewer with the same neutral
brief and current article, without earlier verdicts. Opening a new tab on the same
conversation does not reset context. Reuse an existing review chat only to check
whether its previous findings were addressed, and label that as follow-up review.
New web chats can still inherit account or project memory, so do not promise
complete context isolation.

For a fresh checkout, use existing human-written posts as voice examples. The local,
ignored `docs/blog-project-knowledge.md` and `docs/writing-style-guide.md` provide
additional writing references when present. Their old stack, hosting, and timezone
metadata are not current project configuration.

## Execution and shared tooling

Execute an authorized plan continuously. Do not ask to proceed between its tasks;
stop for real blockers or required user decisions. Send useful progress updates.

Keep reusable skills and `skills-lock.json` Git-visible by default. Preserve the
existing narrow ignore exception for `.agents/skills/publishing-wwdc-sessions/`,
which contains private workspace references. The preference to share skills does
not authorize exposing that exception or private research material.

## UI verification

Keep the visible `Social Links:` label on the homepage; Ivan prefers it to an
unlabelled icon row.

For UI work, preview real pages throughout implementation using the available
Playwright/browser tooling. Build and lint alone do not verify appearance. Cover
1280×800 desktop and 375×812 mobile, light and dark themes, plus horizontal overflow
at 360px. On mobile, setting `localStorage.theme` and reloading can exercise themes
when the toggle is behind navigation. Inspect element and viewport screenshots,
then verify the production preview. Keep screenshots in ignored `.playwright-mcp/`.
For view-transition diagnostics, pausing animations after `viewTransition.ready`
survives a head swap more reliably than injected CSS.

## Distribution preferences

The author handles distribution. When asked for copy, the prior launch pattern was
one LinkedIn overview post with a native landscape image and a link in the first
comment, followed by separate deep-dive posts spaced over time. X used a hook and a
post per article. Treat this as a saved preference, not a verified claim about
platform ranking or current platform features. Per-launch drafts stay in ignored
`social/`. Apply the same prose review and em-dash preferences to social copy.
