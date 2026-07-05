export const meta = {
  name: 'post-draft',
  description: 'Blog pipeline phase 2: 4 variants, critique, pairwise judging, generative merge, quality gates, package',
  whenToUse: 'Invoked by the writing-blog-post skill after the outline checkpoint, with {slug, pubDatetime}. Reads direction.md + research-packet.md, produces final.md + handoff.md in workspace/posts/<slug>/.',
  phases: [
    { title: 'Variants', detail: '4 parallel drafters, deliberately different angles' },
    { title: 'Critique', detail: 'per-variant style/structure/AI-tell audit' },
    { title: 'Judge', detail: 'pairwise, order-swapped, style-guide-anchored ranking' },
    { title: 'Merge', detail: 'generative merge of all variants informed by critiques + ranking' },
    { title: 'Facts gate', detail: 'claim extraction, source verification, code-block audit, bounded revision' },
    { title: 'Style gate', detail: 'forbidden phrases, metrics, bounded revision' },
    { title: 'Mechanics gate', detail: 'frontmatter, headings, llms.txt entry' },
    { title: 'Package', detail: 'final.md + handoff.md' },
  ],
}

const REPO = '/Users/jetbrains/Developer/blog'
const VOICE_DOC = `${REPO}/docs/blog-project-knowledge.md`
const STYLE_DOC = `${REPO}/docs/writing-style-guide.md`
const STOP_SLOP = '/Users/jetbrains/.agents/skills/stop-slop'

const slug = args?.slug
const pubDatetime = args?.pubDatetime
if (!slug) throw new Error('post-draft needs args.slug')
if (!pubDatetime) throw new Error('post-draft needs args.pubDatetime (current UTC ISO string)')
const postDir = `${REPO}/workspace/posts/${slug}`
const DIRECTION = `${postDir}/direction.md`
const PACKET = `${postDir}/research-packet.md`
const MERGED = `${postDir}/merged.md`

const DRAFTER_COMMON = `You are drafting a blog post for ivanmagda.dev. Read, in this order, IN FULL:
1. ${DIRECTION} — the approved direction. It is a contract: thesis, outline, constraints, preserved phrasings are fixed.
2. ${PACKET} — the ONLY factual source. Never invent facts, numbers, quotes, or APIs beyond it.
3. ${VOICE_DOC} §2 (voice rules AND the forbidden-phrases list — internalize both), §3 (template + metrics), §4 (code blocks), §5 (transitions), §7 (editorial lessons), §8 (bugs pattern).
4. The exemplar posts named in direction.md — read 1-2 fully to absorb the voice. Match them, don't copy them.

Pay special attention to §2's DON'T rules and forbidden-phrases list (including the em-dash policy), §3's heading-arc rule, and §4's setup-prose-before-code rules: these are what drafts most often violate. Follow the doc, not your memory of it.

Write a COMPLETE post: YAML frontmatter (title, author: "Ivan Magda", pubDatetime: ${pubDatetime}, slug: ${slug}, featured: false, draft: true, tags, description — write a workable description ≤160 chars ending with a period; the mechanics gate owns the final polish) followed by the full body. If direction.md lists preserved phrasings, weave them in verbatim.`

const ANGLES = [
  {
    key: 'A',
    brief: 'Scenario-first: open inside a concrete situation ("Let\'s say we\'re building...") and let the problem emerge from the scenario before naming any mechanism.',
  },
  {
    key: 'B',
    brief: 'Problem-first: open with the pain or limitation the reader already feels, sharpen it with the "However" pivot, then promise the resolution.',
  },
  {
    key: 'C',
    brief: 'Mechanism-first: lead with the single most surprising insight or design decision from the research packet, then unpack why it matters and how it works.',
  },
  {
    key: 'D',
    brief: 'Reader-journey: start from what the reader does today (their current tool/habit/assumption), then bridge step by step to the new approach, contrasting as you go.',
  },
]

const CRITIQUE_SCHEMA = {
  type: 'object',
  required: ['variant', 'styleViolations', 'aiTells', 'metrics', 'strengths'],
  properties: {
    variant: { type: 'string' },
    styleViolations: { type: 'array', items: { type: 'string' }, description: 'each: rule + quoted offending text' },
    aiTells: { type: 'array', items: { type: 'string' } },
    metrics: {
      type: 'object',
      properties: {
        wordCount: { type: 'number' },
        codeBlocks: { type: 'number' },
        oversizedCodeBlocks: { type: 'number', description: 'blocks over 20 lines' },
        undersizedCodeBlocks: { type: 'number', description: 'blocks under 8 lines' },
        headingsTellArc: { type: 'boolean' },
        stackedCodeBlocks: { type: 'boolean', description: 'two blocks with no prose between' },
      },
    },
    strengths: { type: 'array', items: { type: 'string' }, description: 'what the merger should steal from this variant' },
  },
}

const VERDICT_SCHEMA = {
  type: 'object',
  required: ['winner', 'reason'],
  properties: {
    winner: { type: 'string', enum: ['first', 'second', 'tie'] },
    reason: { type: 'string', description: 'one sentence' },
  },
}

// ---------- Phase: Variants + Critique (pipelined per variant) ----------
const variantResults = (
  await pipeline(
    ANGLES,
    (angle) =>
      agent(
        `${DRAFTER_COMMON}

Your assigned angle (this is what makes your draft different from the parallel ones):
${angle.brief}

Write the post to ${postDir}/variants/${angle.key}.md and return a 3-sentence summary of the lead you chose.`,
        { label: `draft:${angle.key}`, phase: 'Variants' }
      ),
    (draftSummary, angle) =>
      draftSummary === null
        ? null
        : agent(
            `You are an editorial critic. The draft: ${postDir}/variants/${angle.key}.md — read it fully.
Audit it against, read both: ${VOICE_DOC} §2 (voice rules + forbidden phrases list) and §3 (structural metrics table); skim ${STYLE_DOC} Part 2 for do/don't nuances.

Also scan for AI-writing tells using the stop-slop pattern catalog as the reference list — read ${STOP_SLOP}/SKILL.md and ${STOP_SLOP}/references/phrases.md + ${STOP_SLOP}/references/structures.md. Ivan-specific emphasis on top of the catalog: em-dash overuse (his known aversion) and negative parallelisms ("It's not X, it's Y").

Count metrics yourself (Bash wc/grep are available). Report violations with QUOTED text so the merger can act without re-auditing. Also report strengths: the specific passages, framings, or explanations the merged draft should keep from this variant. variant="${angle.key}".

Also write your full critique (violations with quotes, AI tells, metrics, strengths) to ${postDir}/critiques/${angle.key}.md.`,
            { label: `critique:${angle.key}`, phase: 'Critique', schema: CRITIQUE_SCHEMA }
          ).then((c) => {
            if (!c) log(`Critique for variant ${angle.key} failed — keeping draft without critique`)
            return { key: angle.key, path: `${postDir}/variants/${angle.key}.md`, critique: c || null }
          })
  )
).filter(Boolean)

if (variantResults.length === 0) throw new Error('All variant drafters failed')
if (variantResults.length < 2) log(`Only ${variantResults.length} variant survived — merge will be a cleanup pass`)

// ---------- Phase: Judge (pairwise, order-swapped, Copeland scores) ----------
phase('Judge')

const JUDGE_PROMPT = (pathFirst, pathSecond) => `You are ranking two drafts of the SAME planned blog post for ivanmagda.dev. Read both fully:
- FIRST: ${pathFirst}
- SECOND: ${pathSecond}

Rubric — judge ONLY against the house standard, read it first: ${VOICE_DOC} §2 (voice), §3 (structure). Dimensions: (1) voice adherence, (2) teaching quality: why-before-how, scenario grounding, show-the-gap rhythm, (3) clarity and momentum of the argument, (4) how human it sounds: prefer specific, plain, occasionally imperfect prose over polished generic smoothness. Known judge biases to actively resist: do NOT reward length, markdown density, hedged completeness, or "AI-polished" evenness.

Pick the draft a demanding human editor would rather START FROM.`

const pairs = []
for (let i = 0; i < variantResults.length; i++)
  for (let j = i + 1; j < variantResults.length; j++) pairs.push([variantResults[i], variantResults[j]])

const scores = {}
for (const v of variantResults) scores[v.key] = 0
const judgeNotes = []

if (pairs.length) {
  const judgeThunks = []
  for (const [a, b] of pairs) {
    judgeThunks.push(() =>
      agent(JUDGE_PROMPT(a.path, b.path), { label: `judge:${a.key}v${b.key}`, phase: 'Judge', schema: VERDICT_SCHEMA }).then(
        (v) => v && { pair: `${a.key} vs ${b.key}`, winner: v.winner === 'first' ? a.key : v.winner === 'second' ? b.key : null, reason: v.reason }
      )
    )
    judgeThunks.push(() =>
      agent(JUDGE_PROMPT(b.path, a.path), { label: `judge:${b.key}v${a.key}`, phase: 'Judge', schema: VERDICT_SCHEMA }).then(
        (v) => v && { pair: `${b.key} vs ${a.key}`, winner: v.winner === 'first' ? b.key : v.winner === 'second' ? a.key : null, reason: v.reason }
      )
    )
  }
  const verdicts = (await parallel(judgeThunks)).filter(Boolean)
  for (const v of verdicts) {
    if (v.winner) scores[v.winner] += 1
    judgeNotes.push(`${v.pair}: ${v.winner || 'tie'} — ${v.reason}`)
  }
}
const ranking = Object.entries(scores)
  .sort((x, y) => y[1] - x[1])
  .map(([k, s]) => `${k}(${s})`)
  .join(' > ')
log(`Judge ranking: ${ranking}`)

// ---------- Phase: Merge ----------
phase('Merge')

const critiquesJson = JSON.stringify(
  variantResults.map((v) =>
    v.critique
      ? { variant: v.key, ...v.critique }
      : { variant: v.key, critique: 'UNAVAILABLE — critic failed; audit this variant yourself before reusing its text' }
  ),
  null,
  2
)

const mergeResult = await agent(
  `You are the merge stage: synthesize ONE draft that is better than every variant (generative merge, not selection).

Read fully, in order:
1. ${DIRECTION} (the contract) and ${PACKET} (the only factual source)
2. All variants: ${variantResults.map((v) => v.path).join(', ')}
3. ${VOICE_DOC} §2-§5

Pairwise-judge ranking (wins): ${ranking} — use the top-ranked variant as the SPINE, then graft in the strengths of the others.
Critiques of every variant (violations are pre-quoted; do not reintroduce them):
${critiquesJson}

Rules: fix every quoted violation, EXCEPT preserved phrasings from direction.md — they are verbatim-untouchable and WIN over any quoted violation; if a critique quotes text inside one, leave it unchanged and mention it in your return. No new facts beyond the packet. Keep the frontmatter (title/slug/tags may be improved within direction.md's intent).

Write the merged post to ${MERGED}. Return: 4-6 sentences on what you took from which variant and why.`,
  { label: 'merge', phase: 'Merge' }
)
if (!mergeResult) throw new Error('Merge agent failed')

// ---------- Phase: Facts gate ----------
phase('Facts gate')

const CLAIMS_SCHEMA = {
  type: 'object',
  required: ['claims'],
  properties: {
    claims: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'text', 'kind'],
        properties: {
          id: { type: 'string' },
          text: { type: 'string', description: 'the claim as stated in the draft' },
          kind: { type: 'string', enum: ['web', 'code', 'packet-internal'] },
          packetSource: { type: 'string', description: 'source the packet gives, if any' },
        },
      },
    },
  },
}

const FACT_VERDICTS_SCHEMA = {
  type: 'object',
  required: ['verdicts'],
  properties: {
    verdicts: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'verdict'],
        properties: {
          id: { type: 'string' },
          verdict: { type: 'string', enum: ['supported', 'contradicted', 'unverifiable'] },
          evidence: { type: 'string', description: 'URL/file + one sentence' },
          fix: { type: 'string', description: 'suggested rewrite if not supported' },
        },
      },
    },
  },
}

const gateLogs = { facts: [], style: [], mechanics: [] }
let factBlockers = []

const extraction = await agent(
  `Read ${MERGED} fully. Extract every VERIFIABLE factual claim: API names/behavior, numbers, quotes, statements about tools/platforms/history, code-behavior assertions tied to a repo. SKIP opinions, advice, and the author's own experience reports. kind: "web" (verify online), "code" (verify against a source repo referenced in ${PACKET} or ${DIRECTION}), "packet-internal" (packet cites a source — verify the packet didn't distort it). Assign ids c1, c2, ...`,
  { label: 'facts:extract', phase: 'Facts gate', schema: CLAIMS_SCHEMA }
)
if (!extraction) {
  gateLogs.facts.push('Extraction agent FAILED — no claim extraction ran')
  factBlockers.push('claim extraction agent died — draft is NOT fact-checked; verify all factual claims manually before publishing')
}
const claims = extraction ? extraction.claims : []
log(extraction ? `Facts gate: ${claims.length} verifiable claims` : 'Facts gate: extraction FAILED')

function chunk(arr, n) {
  const out = []
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n))
  return out
}

const REVISED_NOTE = `NOTE: ${MERGED} was REVISED after these claims failed verification; each claim's "text" below is the PRE-REVISION wording. First Read ${MERGED} and locate what the draft NOW says for each claim id (use the old text to find the spot). Verify the CURRENT draft statement against primary sources. If the statement was removed, or rewritten so it no longer makes the failed assertion, return verdict "supported" with evidence "resolved by revision". A sentence wrapped in <!-- BLOCKER --> is deliberately unrevised: verify it as-is so it escalates.

`

async function verifyClaims(list, round) {
  const preamble = round > 1 ? REVISED_NOTE : ''
  const webish = list.filter((c) => c.kind !== 'code')
  const codeish = list.filter((c) => c.kind === 'code')
  const thunks = chunk(webish, 5).map((batch, i) => () =>
    agent(
      `${preamble}Verify each claim below against primary sources. For "web": WebSearch/WebFetch official docs, repos, papers. For "packet-internal": open the source in ${PACKET} (WebFetch URLs, Read files) and confirm the claim matches what the source actually says. Default skeptical: if you cannot confirm, verdict is "unverifiable", never "supported".

Claims:
${JSON.stringify(batch, null, 2)}`,
      { label: `facts:verify:${round}:${i}`, phase: 'Facts gate', schema: FACT_VERDICTS_SCHEMA }
    )
  )
  if (codeish.length)
    thunks.push(() =>
      agent(
        `${preamble}Verify these code-related claims against the ACTUAL source. Find the repo/tag referenced in ${DIRECTION} or ${PACKET}, then Read the real files (clone shallowly into ${postDir}/tmp-src if it is a remote repo and not already present). Every code claim must match the source at the referenced tag (house rule: never invent examples). Claims:
${JSON.stringify(codeish, null, 2)}`,
        { label: `facts:verify-code:${round}`, phase: 'Facts gate', schema: FACT_VERDICTS_SCHEMA }
      )
    )
  const results = (await parallel(thunks)).filter(Boolean)
  const verdicts = results.flatMap((r) => r.verdicts)
  // Backfill: a dead verify batch must not read as implicit "supported"
  const got = new Set(verdicts.map((v) => v.id))
  for (const c of list)
    if (!got.has(c.id)) verdicts.push({ id: c.id, verdict: 'unverifiable', evidence: 'verify agent failed for this batch' })
  return verdicts
}

// Round-1 code-block audit: exhaustive, independent of extracted claims (house rule §7)
const codeAudit = await agent(
  `Read ${MERGED} fully. First determine whether ${DIRECTION} or ${PACKET} references a source repo/tag for the post's code. If NOT, return { "verdicts": [] }. Otherwise: Read the repo at the referenced tag (clone shallowly into ${postDir}/tmp-src if remote and not already present), then enumerate EVERY fenced code block in ${MERGED} and check each against the corresponding source — every identifier, parameter, and API in a block must exist in the source at that tag (house rule: never invent examples). Return one verdict per code block with ids cb1, cb2, ... in document order; verdict "supported" only when the block matches; quote the offending block text in "fix" so a reviser can locate it.`,
  { label: 'facts:code-audit', phase: 'Facts gate', schema: FACT_VERDICTS_SCHEMA }
)
if (!codeAudit) gateLogs.facts.push('Code-block audit agent FAILED — code blocks NOT verified against source; check manually before publishing')
const codeAuditVerdicts = codeAudit ? codeAudit.verdicts : []

let verdictRecord = []
{
  let verdicts = []
  if (claims.length) verdicts = await verifyClaims(claims, 1)
  verdicts.push(...codeAuditVerdicts)

  // Synthetic claims for failed code blocks so the recheck round can target them
  const syntheticClaims = codeAuditVerdicts
    .filter((v) => v.verdict !== 'supported')
    .map((v) => ({ id: v.id, text: v.fix || v.evidence || 'code block flagged by audit', kind: 'code' }))
  const allClaims = [...claims, ...syntheticClaims]

  const byId = {}
  for (const v of verdicts) byId[v.id] = v

  let bad = verdicts.filter((v) => v.verdict !== 'supported')
  if (claims.length || codeAuditVerdicts.length)
    gateLogs.facts.push(`Round 1: ${verdicts.length} verdicts (${codeAuditVerdicts.length} from code audit), ${bad.length} not supported`)

  if (bad.length) {
    const revised = await agent(
      `You are a surgical reviser. ${MERGED} contains claims that failed verification. First read ${DIRECTION} and note its Preserved phrasings: they are verbatim-untouchable — if a failing claim lies inside one, do NOT rewrite it; wrap the sentence in <!-- BLOCKER: ... --> instead. Apply ONLY these verdicts (Edit the file in place; smallest possible changes; preserve voice; if a claim is load-bearing and contradicted with no safe rewrite, use the <!-- BLOCKER: ... --> marker instead of writing around the hole):
${JSON.stringify(bad, null, 2)}
The claims by id:
${JSON.stringify(allClaims.filter((c) => bad.some((b) => b.id === c.id)), null, 2)}`,
      { label: 'facts:revise', phase: 'Facts gate' }
    )
    if (revised === null) {
      gateLogs.facts.push('Reviser agent DIED — escalating round-1 failures unrevised')
      factBlockers.push(
        ...bad.map((v) => {
          const c = allClaims.find((x) => x.id === v.id)
          return `[${v.id}] "${c ? c.text : '?'}" → ${v.verdict}${v.evidence ? ` (${v.evidence})` : ''} (unrevised: reviser failed)`
        })
      )
    } else {
      const recheck = allClaims.filter((c) => bad.some((b) => b.id === c.id))
      const verdicts2 = await verifyClaims(recheck, 2)
      for (const v of verdicts2) byId[v.id] = v
      const stillBad = verdicts2.filter((v) => v.verdict !== 'supported')
      gateLogs.facts.push(`Round 2 (recheck ${recheck.length}): ${stillBad.length} still not supported`)
      factBlockers.push(
        ...stillBad.map((v) => {
          const c = allClaims.find((x) => x.id === v.id)
          return `[${v.id}] "${c ? c.text : '?'}" → ${v.verdict}${v.evidence ? ` (${v.evidence})` : ''}`
        })
      )
    }
  }

  verdictRecord = allClaims.map((c) => ({ ...c, ...(byId[c.id] || { verdict: 'unchecked', evidence: 'no verdict returned' }) }))
}

// ---------- Phase: Style gate ----------
phase('Style gate')

const STYLE_SCAN_SCHEMA = {
  type: 'object',
  required: ['violations', 'clean'],
  properties: {
    clean: { type: 'boolean' },
    violations: { type: 'array', items: { type: 'string' }, description: 'each: rule + quoted text + location hint' },
  },
}

const STYLE_SCAN_PROMPT = `Deterministically scan ${MERGED}:
1. Read ${VOICE_DOC} §2 first; derive EVERY grep pattern (Bash) from its forbidden-phrases list and its DON'T rules — including the em-dash policy (title ban + body budget) — no patterns from memory.
2. Check metrics against §3's table: word count, code-block line counts against the target range, two code blocks with no prose between, body headings start at ## and none skip a level, "you" outside the closing section.
Report every hit with quoted text. clean=true only if zero violations.`

let styleScan = await agent(STYLE_SCAN_PROMPT, { label: 'style:scan', phase: 'Style gate', schema: STYLE_SCAN_SCHEMA })
let styleBlockers = []
if (styleScan === null) {
  gateLogs.style.push('Round 1: scan agent FAILED — style gate did not run')
  styleBlockers = ['style scan agent failed; draft has NOT been style-checked']
} else if (!styleScan.clean) {
  const round1Violations = styleScan.violations
  gateLogs.style.push(`Round 1: ${round1Violations.length} violations`)
  await agent(
    `Surgical reviser. First read ${DIRECTION} and note its Preserved phrasings: they are untouchable — if a violation falls inside one, skip it (the rescan will escalate it). Fix ONLY these style violations in ${MERGED} (Edit in place, minimal diffs, keep meaning and voice; consult ${VOICE_DOC} §2 for the approved replacements):
${JSON.stringify(round1Violations, null, 2)}`,
    { label: 'style:revise', phase: 'Style gate' }
  )
  styleScan = await agent(STYLE_SCAN_PROMPT, { label: 'style:rescan', phase: 'Style gate', schema: STYLE_SCAN_SCHEMA })
  if (styleScan === null) {
    gateLogs.style.push('Round 2: rescan agent FAILED — revision unverified')
    styleBlockers = round1Violations.map((v) => `unverified after revise (rescan failed): ${v}`)
  } else if (!styleScan.clean) {
    styleBlockers = styleScan.violations
    gateLogs.style.push(`Round 2: ${styleScan.violations.length} unresolved → escalated`)
  } else {
    gateLogs.style.push('Round 2: clean')
  }
} else {
  gateLogs.style.push('Round 1: clean')
}

// ---------- Phase: Mechanics gate ----------
phase('Mechanics gate')

const MECHANICS_SCHEMA = {
  type: 'object',
  required: ['fixed', 'llmsEntry', 'issues'],
  properties: {
    fixed: { type: 'array', items: { type: 'string' } },
    issues: { type: 'array', items: { type: 'string' }, description: 'anything needing a human call' },
    llmsEntry: { type: 'string', description: 'the exact line(s) to append to public/llms.txt' },
  },
}

const mechanics = await agent(
  `Mechanics pass on ${MERGED}. First read ${DIRECTION} and note its Preserved phrasings — never edit text inside one; if a mechanics fix would touch it, report it in issues instead. Fix in place (Edit), then report:
- Frontmatter: exact field order and shape as existing posts in ${REPO}/src/data/blog/ (read one non-synth post to confirm); title has no em dashes; author "Ivan Magda"; pubDatetime ${pubDatetime}; slug ${slug}; featured false; draft true; tags reuse existing tags where close enough (check other posts' tags; flag brand-new singleton tags as an issue, don't remove them); description ≤160 chars ending with a period; NO ogImage, NO canonicalURL, NO modDatetime keys at all (empty strings are a known SEO trap — omit entirely).
- Body: headings start at ##, hierarchy never skips a level; all external links https; closing matches the house sign-off per ${VOICE_DOC} §7 if a sign-off exists.
- Compose llmsEntry: read ${REPO}/public/llms.txt to match its format, produce the exact entry line(s) for this post under the right section (do NOT edit llms.txt itself).`,
  { label: 'mechanics', phase: 'Mechanics gate', schema: MECHANICS_SCHEMA }
)
if (mechanics) gateLogs.mechanics.push(...mechanics.fixed)
else gateLogs.mechanics.push('Mechanics agent FAILED — gate never ran')

// ---------- Phase: Package ----------
phase('Package')

const allBlockers = [
  ...factBlockers.map((b) => `FACTS: ${b}`),
  ...styleBlockers.map((b) => `STYLE: ${b}`),
  ...(mechanics
    ? (mechanics.issues || []).map((i) => `MECHANICS: ${i}`)
    : ['MECHANICS: gate did not run — frontmatter (ogImage/canonicalURL empty-string trap, description, field order) and llms.txt entry are unchecked']),
]

const llmsEntry = mechanics ? mechanics.llmsEntry : null

const packageResult = await agent(
  `Package the pipeline run. Copy ${MERGED} to ${postDir}/final.md (exact copy). Then write ${postDir}/handoff.md for the author with these sections:

1. Blockers (${allBlockers.length}) — needs the author's decision first:
${allBlockers.length ? allBlockers.map((b) => `- ${b}`).join('\n') : '- none'}

2. Verified claims — copy from the verdict record below: one line per claim (text, verdict, evidence). Sources used = the evidence fields, verbatim. Do NOT invent provenance.
${JSON.stringify(verdictRecord, null, 2)}

3. Double-check by eye — derive from the verdict record: entries with kind "packet-internal", verdict "unchecked" or "unverifiable"; any <!-- BLOCKER --> markers left in ${postDir}/final.md (grep for them); singleton tags; and any gate-log line below containing FAILED or DIED.

4. How the draft was made — variants ranking: ${ranking}; merge notes: ${JSON.stringify(mergeResult)}; judge notes:
${judgeNotes.map((n) => `- ${n}`).join('\n') || '- (no pairwise verdicts returned)'}
Condense the per-variant critiques from ${postDir}/critiques/ into a short subsection.

5. Gate logs (verbatim):
${JSON.stringify(gateLogs, null, 2)}

6. Prepared llms.txt entry — reproduce verbatim in a fenced block for the author to append in the finish step:
${llmsEntry || '(mechanics agent failed — compose one by reading public/llms.txt format)'}

Return one paragraph: the state of the draft and the single most important thing the author should look at first.`,
  { label: 'package', phase: 'Package' }
)

return {
  slug,
  finalPath: `${postDir}/final.md`,
  handoffPath: `${postDir}/handoff.md`,
  blockers: allBlockers,
  ranking,
  variantsSurvived: variantResults.length,
  claimsChecked: verdictRecord.length,
  llmsEntry,
  summary: packageResult || 'package agent failed — read handoff.md and final.md directly',
}
