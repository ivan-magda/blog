export const meta = {
  name: 'post-research',
  description: 'Blog pipeline phase 1: intake, research fan-out, research packet + outline candidates',
  whenToUse: 'Invoked by the writing-blog-post skill with {topic|draftPath, materials?}. Writes workspace/posts/<slug>/research-packet.md and outlines.md, returns outline candidates for the checkpoint.',
  phases: [
    { title: 'Intake', detail: 'parse input, propose slug, derive research angles' },
    { title: 'Research', detail: 'local materials, web angles, own-blog context, landscape scan' },
    { title: 'Synthesize', detail: 'research packet + 2-3 outline candidates' },
  ],
}

const REPO = '/Users/jetbrains/Developer/blog'
const VOICE_DOC = `${REPO}/docs/blog-project-knowledge.md`

// Tolerate args arriving as a JSON-encoded string (easy invocation slip)
const input = typeof args === 'string' ? JSON.parse(args) : args
const topic = input?.topic
const draftPath = input?.draftPath
const materials = input?.materials || []
if (!topic === !draftPath) throw new Error('post-research needs exactly one of args.topic or args.draftPath')

const INTAKE_SCHEMA = {
  type: 'object',
  required: ['slug', 'inputType', 'workingTitle', 'theses', 'researchAngles'],
  properties: {
    slug: { type: 'string', description: 'kebab-case working slug' },
    inputType: { type: 'string', enum: ['topic', 'draft'] },
    workingTitle: { type: 'string' },
    theses: { type: 'array', items: { type: 'string' }, description: '2-3 candidate theses' },
    preservedPhrasings: { type: 'array', items: { type: 'string' }, description: "Ivan's verbatim phrasings worth keeping (draft input only)" },
    claimsToVerify: { type: 'array', items: { type: 'string' } },
    gaps: { type: 'array', items: { type: 'string' } },
    researchAngles: { type: 'array', items: { type: 'string' }, description: '2-4 web-research angles' },
  },
}

const FINDINGS_SCHEMA = {
  type: 'object',
  required: ['summary', 'facts'],
  properties: {
    summary: { type: 'string', description: '3-6 sentences' },
    facts: {
      type: 'array',
      items: {
        type: 'object',
        required: ['claim', 'source'],
        properties: {
          claim: { type: 'string' },
          source: { type: 'string', description: 'URL or file path' },
          confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
        },
      },
    },
    perspectives: { type: 'array', items: { type: 'string' }, description: 'angles/framings observed' },
    warnings: { type: 'array', items: { type: 'string' }, description: 'contested claims, overlaps, risks' },
  },
}

const OUTLINES_SCHEMA = {
  type: 'object',
  required: ['packetPath', 'outlinesPath', 'outlines', 'recommendedId'],
  properties: {
    packetPath: { type: 'string' },
    outlinesPath: { type: 'string' },
    outlines: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'title', 'thesis', 'angle', 'headings', 'wordEstimate', 'template'],
        properties: {
          id: { type: 'string' },
          title: { type: 'string' },
          thesis: { type: 'string' },
          angle: { type: 'string', description: 'one sentence: how this candidate frames the topic' },
          headings: { type: 'array', items: { type: 'string' } },
          wordEstimate: { type: 'number' },
          template: { type: 'string', enum: ['series-style', 'standalone'] },
        },
      },
    },
    recommendedId: { type: 'string' },
    openRisks: { type: 'array', items: { type: 'string' } },
  },
}

// ---------- Phase 1: Intake ----------
phase('Intake')

const inputDesc = topic
  ? `Topic given by the author: "${topic}"`
  : `Rough draft by the author at: ${draftPath} — Read it fully.`

const intake = await agent(
  `You are the intake stage of a blog-post pipeline for ivanmagda.dev (author: Ivan Magda; audience: Apple-platform and AI-agent developers).

${inputDesc}
${materials.length ? `Supporting materials provided (read each, skim for scope):\n${materials.map(m => `- ${m}`).join('\n')}` : 'No supporting materials provided.'}

Read ${VOICE_DOC} §1 (blog identity) for content direction. Then produce:
- a kebab-case working slug (match the naming style of files in ${REPO}/src/data/blog/, ignore synth-*.md)
- a working title (no em dashes in titles — house rule)
- 2-3 candidate theses (if input is a draft, the FIRST thesis must be Ivan's own, extracted faithfully)
- preservedPhrasings: if input is a draft, list Ivan's distinctive verbatim phrasings that must survive into the final post
- claimsToVerify: factual claims in the input that need sources
- gaps: what the input doesn't cover but the post will need
- researchAngles: 2-4 distinct web-research angles (specific, not generic); if input is a draft, derive them from claimsToVerify and gaps (verification and sourcing angles), not fresh landscape framings

Write nothing to disk. Return via StructuredOutput only.`,
  { label: 'intake', schema: INTAKE_SCHEMA }
)
if (!intake) throw new Error('Intake agent failed')
const slug = intake.slug
const postDir = `${REPO}/workspace/posts/${slug}`
log(`Intake: slug=${slug}, ${intake.researchAngles.length} research angles`)

// ---------- Phase 2: Research fan-out ----------
phase('Research')

const intakeJson = JSON.stringify(intake, null, 2)
const commonHeader = `You are a research agent for a blog post on ivanmagda.dev. Intake analysis:\n${intakeJson}\n`

const researchThunks = []

if (materials.length) {
  researchThunks.push(() =>
    agent(
      `${commonHeader}
Read these local source materials IN FULL:
${materials.map(m => `- ${m}`).join('\n')}

Extract everything relevant to the theses: hard facts, API names/signatures, numbers, quotes worth citing, code snippets worth showing. Every fact must carry its file path as source. Also write your raw notes to ${postDir}/research/local-notes.md (create the file).`,
      { label: 'research:local-materials', phase: 'Research', schema: FINDINGS_SCHEMA }
    )
  )
}

for (const angle of intake.researchAngles.slice(0, 4)) {
  researchThunks.push(() =>
    agent(
      `${commonHeader}
Web-research this angle: "${angle}"

Use WebSearch and WebFetch. Prefer primary sources (official docs, source repos, papers, first-party posts). Every fact must carry its URL. Mark anything contested or single-sourced in warnings. 6-12 solid facts beat 30 shallow ones.`,
      { label: `research:web:${angle.slice(0, 40)}`, phase: 'Research', schema: FINDINGS_SCHEMA }
    )
  )
}

if (intake.inputType === 'draft' && (intake.claimsToVerify || []).length) {
  researchThunks.push(() =>
    agent(
      `${commonHeader}
Verify each of the author's draft claims against primary sources (WebSearch/WebFetch official docs, repos, papers):
${JSON.stringify(intake.claimsToVerify, null, 2)}

Return one fact per claim: the verdict-bearing statement with its source (confidence low if contested or unconfirmable — also add a warning). Then source the gaps the intake listed: ${JSON.stringify(intake.gaps || [])}.`,
      { label: 'research:claim-verification', phase: 'Research', schema: FINDINGS_SCHEMA }
    )
  )
}

researchThunks.push(() =>
  agent(
    `${commonHeader}
Scan the blog's own published posts in ${REPO}/src/data/blog/ (ignore synth-*.md files entirely). Find:
- posts related to this topic → cross-link candidates (as facts, with the post's slug-derived URL path as source)
- material overlap → warnings ("post X already covers Y, don't repeat")
- the blog's established positions/terminology this post should stay consistent with (as perspectives)`,
    { label: 'research:own-blog', phase: 'Research', schema: FINDINGS_SCHEMA }
  )
)

researchThunks.push(() =>
  agent(
    `${commonHeader}
Landscape scan: what has already been written online about this topic? Use WebSearch. Survey the strongest 5-8 existing articles/threads. Report:
- what framings and angles they use (perspectives)
- what they all miss or get wrong — the differentiation opportunity for our post (as facts with the source URL of what you surveyed)
- warnings if the topic is saturated and our angle must be sharper`,
    { label: 'research:landscape', phase: 'Research', schema: FINDINGS_SCHEMA }
  )
)

const research = (await parallel(researchThunks)).filter(Boolean)
if (!research.length) throw new Error('All research agents failed')
log(`Research: ${research.length}/${researchThunks.length} agents returned, ${research.reduce((n, r) => n + r.facts.length, 0)} facts`)

// ---------- Phase 3: Synthesize ----------
phase('Synthesize')

const synthesis = await agent(
  `You are the synthesis stage of a blog-post pipeline. Combine intake + research into two files.

Intake:
${intakeJson}

Research findings (${research.length} agents):
${JSON.stringify(research, null, 2)}

Read ${VOICE_DOC} §3 (article templates) and §13 (pre-publish checklist) to shape outlines correctly.

Write TWO files:

1. ${postDir}/research-packet.md — the single source drafters may use. Sections: Verified facts (each with source), Code references, Perspectives, Cross-links to our own posts, Warnings & contested claims, Material drafters must NOT invent beyond. Deduplicate; keep only what serves the theses.

2. ${postDir}/outlines.md — 2-3 outline candidates with DIFFERENT angles (not reorderings of the same idea). For each: id (A/B/C), title (no em dashes), thesis, template (series-style|standalone), full heading arc (headings must tell the story alone — house rule), per-section one-line notes on what goes in/out, word estimate (house target 1500-2500).
${intake.inputType === 'draft' ? 'The input was Ivan’s own draft: ALL candidates MUST be built around his existing structure and thesis — vary the lead, emphasis, and per-section in/out choices, not the skeleton. Carry preservedPhrasings into the packet verbatim.' : ''}

Then return the structured summary. recommendedId = your honest pick with the strongest thesis-to-evidence fit.`,
  { label: 'synthesize', schema: OUTLINES_SCHEMA }
)
if (!synthesis) throw new Error('Synthesis agent failed')

return {
  slug,
  postDir,
  workingTitle: intake.workingTitle,
  inputType: intake.inputType,
  preservedPhrasings: intake.preservedPhrasings || [],
  packetPath: synthesis.packetPath,
  outlinesPath: synthesis.outlinesPath,
  outlines: synthesis.outlines,
  recommendedId: synthesis.recommendedId,
  openRisks: synthesis.openRisks || [],
}
