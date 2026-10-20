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

During author-led editing, show **current text → proposed text** before changing
files. A request to try improving a paragraph calls for a proposal. Explicit
approval authorizes that wording; an authorized broad editing task does not need
reconfirmation for every routine correction. Preserve accepted author wording.
For a batch of choices, prefer short groups through the available question tool
(the author finds large comparison tables inconvenient). Record decisions so
accepted or superseded choices are not repeatedly presented.

## Review and verification

Check facts before the separate Russian-language pass. Read whole sentences after
changing a term: agreement, case, punctuation and referents can break even when
the replacement sounds better alone. Inspect the diff for altered meaning,
causal strength, units, measured boundaries, code and citations. Apply the same
vocabulary to captions, tables and rendered diagrams; check label fit after
regeneration. Refresh derived publication files only after approved edits.

A second model's review is a suggestion, not evidence. Verify quoted wording
against the current draft and judge each replacement for meaning as well as
naturalness. Do not accept unsupported claims that ordinary phrases are calques,
that conversational language is unprofessional, or that a correct term must be
translated. Do not turn a weaker observation into a stronger guarantee. Preserve
raw reviews separately; current user choices override reviewer preferences.
