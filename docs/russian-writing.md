# Russian technical writing

Applies to Russian articles, adaptations, captions, alt text and diagram labels.
These author-approved conventions take precedence over English voice templates
and mechanical stop-slop prescriptions. They do not require Russian output for
an English publication. Resolve destination and article language separately.

## Terminology from the first draft

Use the term that is precise and familiar to the intended technical reader.
Established English terms are welcome immediately; do not translate everything
first and repair it later. Explain a non-obvious term in ordinary Russian at its
first substantive use, then use it consistently. Keep code identifiers and API
names exact; inline code is appropriate for identifiers such as `Task` and
`deadline`, not required for every English technical noun.

For Swift performance writing, useful choices include `deadline`, `Task`, layout,
inlining, padding, runtime, generic, value witness table, protocol witness table,
false sharing and executor. This is an example vocabulary, not a mandatory
English glossary for all subjects. A worker can still be called «рабочая задача».
Keep clear Russian terms such as «блокировка», «обработчик», «машина состояний»,
«метаданные», «выравнивание» and «задержка»; do not mechanically replace them with
lock, callback, state machine, metadata, alignment or delay.

Distinguish the concepts before choosing synonyms:

- A configured debounce delay is a duration; `deadline` is the end of the waiting
  period; actual handler invocation may happen later. Do not rename `deadline`
  to «момент вызова обработчика» or use ambiguous «срок ожидания» for both.
- Explain trailing debounce as restarting the configured delay after each new
  value. Prefer «задержка debounce» to the literal «интервал/период тишины».
- Describe the measured operation: «среднее время выполнения одного вызова
  `emit`» is clearer than «стоимость приема». Distinguish `send`/`emit` execution,
  handler execution, and lateness beyond the deadline. Preserve the actual
  method name and whether the number is an average over a loop or per-call data.
- Introduce layout as size, alignment and field placement; do not conflate it
  with the address of one instance. Explain inlining as substituting a function
  body at a call site; specialization remains a separate concept.
- Introduce padding as reserved space when discussing memory layout, not merely
  «отступ», which can suggest code formatting.

English terminology is not a license to write translated English syntax around
it. Prefer concrete actions to «частый синхронный путь», «подача всего потока» or
«ожидание предшественника» when the actual function, values or previous task can
be named. Use «поле поиска» or «поле ввода», rather than «поисковое поле».

## Voice and editing

Use the author's Russian texts as voice references, not wording or structural
stencils. Preserve conversational technical explanation. Do not replace a sound
phrase with abstract «затраты», bureaucratic language, slogans or formal prose
just to make a visible edit. Natural dashes, adverbs, impersonal constructions
and passive voice are allowed; blanket English style rules do not apply.
Use «е» instead of «ё» in authored prose and figure labels, preserving exact
source quotations and identifiers where spelling matters.

Review explanations from the reader's current knowledge: name the implementation,
operation or experiment when a generic label is ambiguous, and introduce concepts
before relying on them. Split dense prose by reasoning steps. Preserve the actual
history of an investigation, including accidental discoveries; do not invent motives
for a smooth transition. Before polishing a section, check its role in the main
question. Keep material limits beside the claims they qualify, but consolidate
repeated qualifications across prose, captions and conclusions.

During author-led editing, show **current text → proposed text** before changing
files. A request to try improving a paragraph calls for a proposal. Explicit
approval authorizes that wording; an authorized broad editing task does not need
reconfirmation for every routine correction. Preserve accepted author wording.
For a batch of choices, prefer short groups through the available question tool
(the author finds large comparison tables inconvenient). Record accepted wording,
rejected alternatives and unresolved choices in existing per-post notes. Re-read the current text before applying a delayed approval.

For a local wording request, preserve the accepted surrounding text except for
necessary grammatical repairs. Do not treat a style example as replacement copy
unless the author presents it as such. Reuse relevant approved article wording when
it fits the new context; check that extracted sentences retain their antecedents.
Treat local approval as a local decision, not a global style rule. Separate objective
errors from optional stylistic alternatives; do not reopen a rejected stylistic
replacement without an author request or new evidence affecting its meaning.

## Review and verification

Check facts before the separate Russian-language pass. Read whole sentences after
changing a term: agreement, case, punctuation and referents can break even when
the replacement sounds better alone. Inspect the diff for altered meaning,
causal strength, units, measured boundaries, code and citations. Apply the same
vocabulary to captions, tables and rendered diagrams; check label fit after
regeneration. Refresh derived publication files only after approved edits.

After local edits, read the changed paragraph and its surrounding context. During
the final article pass, check section transitions and repeated qualifications.
Export success does not resolve pending editorial choices. If the author edits the
platform draft, identify the current source of truth before reusing or overwriting
its local preparation copy.

A second model's review is a suggestion, not evidence. Verify quoted wording
against the current draft and judge each replacement for meaning as well as
naturalness. Do not accept unsupported claims that ordinary phrases are calques,
that conversational language is unprofessional, or that a correct term must be
translated. Do not turn a weaker observation into a stronger guarantee. Preserve
raw reviews separately; current user choices override reviewer preferences.

For an independent first draft, provide source material and voice references without
a preferred competing draft. For a targeted rewrite or review, provide the current
article, neighboring passage and relevant author decisions, not just a factual
summary. Authorized account or project memory can supply voice context but does not
replace the current article.
