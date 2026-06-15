---
title: "Stop Shipping AI Features on Vibes: Instruments and Evaluations for Foundation Models"
author: "Ivan Magda"
pubDatetime: 2026-06-15T09:00:00Z
slug: "foundation-models-debug-and-measure"
featured: false
draft: true
tags:
  - wwdc
  - foundation-models
  - swift
  - ai-agents
description: "A reliable Foundation Models feature takes two disciplines: seeing the silent tool-call loop in Instruments, and scoring quality with the Evaluations framework."
---

_This post is part of a series on the WWDC26 Foundation Models updates. Start with [the year-two reframe of Foundation Models](/posts/wwdc26-foundation-models-year-two/) for the full map._

_Everything below comes from the first iOS 27 / macOS 27 developer betas. Most of these APIs are marked Beta in Apple's documentation, and the demo numbers are single-trace readings from one device, not benchmarks. Details may shift before the fall release._

An agentic Foundation Models feature can be broken and never throw a single error. The model keeps answering. It keeps calling tools. The app keeps responding. The whole time it does the wrong thing, with `Error Count: 0` to reassure us everything is fine.

That failure mode sits outside the code we are used to writing. A network call fails loudly, a force-unwrap crashes, a misspelled key returns `nil`. We have spent careers building intuition for code that tells us when it breaks. Generative features break the contract that intuition was built on, and they break it in two ways that need two different tools to catch.

Shipping a reliable Foundation Models feature takes two engineering disciplines. The first is **observability**: seeing inside the tool-call loop where silent failures live and where latency hides, which is what the Xcode 27 Foundation Models instrument is for. The second is **measurement**: because the same input no longer guarantees the same output, we can't unit-test an LLM feature, so the new Evaluations framework replaces "it looked good when I tried it" with a pass rate we assert in CI.

## Profile or evaluate: the top-level decision

Both tools ship in Xcode 27, and both work with any model the framework can drive: on-device, [Private Cloud Compute](/posts/foundation-models-private-cloud-compute/), or a third-party package. They overlap little, so the choice usually comes down to one distinction. Debugging is per-run. Evaluation is per-distribution.

|             | Foundation Models instrument            | Evaluations framework                 |
| ----------- | --------------------------------------- | ------------------------------------- |
| Question    | What did this one run do?               | How often is it right?                |
| Granularity | A single trace                          | A dataset of samples                  |
| Output      | Timeline, tree, latency and token stats | Pass rates and scores, per-metric     |
| Lives in    | Instruments                             | The test target (Swift Testing)       |
| Best for    | Root-cause, latency, token budgets      | Model and prompt selection, CI gates  |
| Repeatable? | No, it captures one real session        | Yes, that is the entire point         |

_The microscope and the census. When something looks wrong and we need to know why, we profile; when something looks fine and we need to know whether it stays fine, we evaluate._

The rule of thumb follows from that table. Most real work uses both in sequence: profile to find the bug, fix it, then write an evaluation so the bug cannot slip back in unnoticed. That sequence is the spine of everything below, and a checklist at the end threads the two tools back together.

## The contract generative code breaks

Every unit test we have ever written rests on one assumption: the same input produces the same output. `assertEqual(add(2, 2), 4)` is only meaningful because `add` is deterministic. That assumption is so foundational we rarely name it.

Foundation Models discards it. Apple's [evaluating prompts](https://developer.apple.com/documentation/foundationmodels/evaluating-prompts-to-measure-performance-and-improve-model-responses) article says so plainly: a response "can vary even though you provide the same exact input." Part of that variance is the probabilistic model itself; part is OS model updates we do not control, since the model under our feature can change out from under us in a point release. The same docs warn that modifying a prompt risks "silently breaking existing functionality," a phrase that should make any Swift developer uneasy, because silent is the one thing our tooling has never had to handle.

The questions change shape. We stop asking "does it return 42?" and start asking statistical ones: how _often_ does the feature go wrong, and how _wrong_ when it does. Once the contract is statistical, both halves of reliability follow. We need to see each run to debug the ones that fail, and aggregate across many runs to know if the feature is good.

## The new failure mode: silence in the loop

Let's make the silent failure concrete, because abstract descriptions undersell how easy this bug class is to ship.

An agentic feature is a loop: a prompt goes in, the model reasons, it calls a tool, the tool acts, the result feeds back, and a response comes out. Every hop is a new place to fail, and almost none of those failures look like exceptions. The model can call the wrong tool, call the right tool with wrong arguments, or fail to call a tool that was never wired up in the first place. That last case bites hardest.

Apple's WWDC26 session [Debug and profile agentic app experiences with Instruments](https://developer.apple.com/videos/play/wwdc2026/243) walks through the canonical example, where the bug is one line and the symptom is invisible. The demo is a crafting-companion app (the same scenario as Apple's [Origami sample](https://developer.apple.com/documentation/foundationmodels/origami-crafting-a-dynamic-tutorial-for-apple-intelligence)) with a brainstorm mode and a tutorial mode. The intended handoff: brainstorm with the user, and once they pick a craft, call `switchToTutorialMode` to swap in the tutorial instructions. The mechanism that makes this fail quietly is [`DynamicInstructions`](https://developer.apple.com/documentation/foundationmodels/dynamicinstructions), where a profile declares its tools inside the same `body` as its instruction text. The brainstorm set as it shipped in the broken build looks like this:

```swift
@MainActor
struct BrainstormDynamicInstructions: DynamicInstructions {
    var state: IdeaState

    var body: some DynamicInstructions {
        Instructions {
            """
            ... Use the switchToTutorialMode tool once the user confirms
            the craft they want to make.
            """
        }
        GenerateCraftIdeasTool(state: state)
        SwitchToTutorialModeTool(state: state)  // the one-line fix, missing in the buggy build
    }
}
```

The prompt names `switchToTutorialMode`; the broken `body` never added it. The model tried to follow instructions it had no tool to satisfy, and with no way out of brainstorm mode, it did the only thing it could: generated more ideas, forever. The user picks "Paper Butterfly," and the app records it as yet another idea instead of building a tutorial. No exception, no log line, `Error Count: 0`. This is the bug class our existing tooling cannot see, because there is nothing for it to catch. (One naming detail to keep straight: the Swift type is `GenerateCraftIdeasTool`, while its runtime name, the string the inspector shows, is `generateCraftIdea`. Same tool, type versus `name`.)

## Instruments as the X-ray

The Xcode 27 Foundation Models instrument handles this. Product ▸ Profile, pick the [Foundation Models template](https://developer.apple.com/documentation/foundationmodels/analyzing-the-runtime-performance-of-your-foundation-models-app), and record a trace of the feature misbehaving. The instrument makes the invisible loop visible, and in the Origami case it surfaces the bug at a glance.

The track lays the recording out as several lanes, with the width of each component on the timeline standing in for its latency. Two of those lanes carry the story here. The **Instructions lane** shows how long each instruction-and-tool set was active, and on the broken trace only _one_ set is active for the entire session, where the design called for two. That single fact is the bug, drawn as a timeline. The **Model Inference lane** colors the work, separating input-prompt processing from response generation, so where time goes reads at a glance.

The detail underneath is a tree (View ▸ Detail Area ▸ Tree): sessions contain requests, requests contain model inferences, and each inference carries its instructions, prompt, and either a response or an error. Walking it confirms the diagnosis. The session ran a single instruction set the whole way through, where the feature is meant to run two, so the instruction set that never changed is the whole bug in one fact. Click the Instructions node and it lists the attached tools: only `generateCraftIdea`, never `switchToTutorialMode`. The fix is the one line above, and a fresh trace shows two distinct sets, brainstorm first and tutorial second, switching where the design intended. The info column is the fast path back to a node worth inspecting, flagging errors, long durations, and large token counts, so next time we follow the flags rather than scrolling the whole tree.

The framing tells us what Apple was after. Apple did not ship a generic "LLM logger." They built the instrument around the tool-call loop as the unit of analysis, so the tool reflects how these features fail rather than how a request happens to be structured. The loop is the thing that breaks, so the loop is the thing the instrument draws. And "Error Count: 0" is necessary but not sufficient: in agentic code, a run that threw nothing is not the same as a run that did the right thing, and the instrument gives us the second signal a thrown-error mindset cannot.

## Traces capture prompts in the clear

One detail in the recording flow is easy to miss and important to get right. A trace, per Apple's docs, "captures and stores all Foundation Models prompts and responses in an unencrypted form." Logging is off in production but _on_ for the duration of the trace, which is why Instruments shows an alert before recording: the captured data can include sensitive information. In the session, the confirmation button is the blunt "Record Anyway."

The rule that follows: treat trace files like secrets. Do not commit them, and do not attach them to a bug report without scrubbing them. A `.trace` bundle from a feature that summarizes someone's journal entries or reads their messages contains exactly the content we promised to keep private. It is a small point, and it costs nothing to get right.

## Three metrics, three fixes

The same instrument answers the other question users care about: is the feature fast. The session's token-metrics view surfaces three latency numbers, and each points at a specific fix rather than a vague "optimize."

**Time to First Token** is the blank-screen wait, from prompt received to first token back. When it is high, people stare at nothing and assume the app hung. The lever is the prompt: shorten it. **Tokens per Second** is raw generation speed, the metric to benchmark across model and prompt configurations and watch for regressions. **Total Latency** is the full round trip, the number users feel, and the fix there is usually masking the wait with streaming so partial results appear sooner, not reaching for a faster model.

![Diagram: three metrics each mapped to a fix; Time to First Token to the input prompt, Tokens per Second as a baseline to benchmark, Total Latency to streaming partial results.](/diagrams/fm-three-numbers-three-fixes.svg)

_Each metric points at a different lever._

"Shorten the prompt" is vague advice, so let's name a concrete, doc-backed lever. Once the model has seen our `@Generable` schema in an earlier request or in the instructions, repeating it wastes input tokens. Setting [`includeSchemaInPrompt`](https://developer.apple.com/documentation/foundationmodels/languagemodelsession/streamresponse(generating:includeschemainprompt:options:prompt:)) to `false` on the follow-ups drops the redundancy, which Apple's docs say "can save hundreds of tokens per request":

```swift
// Excluding the schema on a repeat request can save hundreds of input tokens.
for try await partial in session.streamResponse(
    to: myPrompt,
    generating: MyCustomItinerary.self,
    includeSchemaInPrompt: false
) {
    // Handle the partial result.
}
```

After a change like that, the workflow is the one the docs recommend: record a fresh trace and confirm the token counts moved the way we expected, rather than assuming the optimization worked.

Headline numbers like a time to first token of 0.36s, 110.36 tokens per second, or 491 tokens on one inference are illustration, not benchmark: whatever a single trace reads on one device on a beta build, never a number to quote back. What matters more is what the instrument exposes beyond those three, namely consumed, generated, and cached token counts plus a cache hit rate. That turns cost and context budget from numbers we guess at into numbers we can read, and the token table doubles as an early warning, since a session that overruns the window throws [`contextSizeExceeded(_:)`](https://developer.apple.com/documentation/foundationmodels/languagemodelerror/contextsizeexceeded(_:)). For a feature on a metered third-party model, or one spending a user's daily PCC quota, that is the difference between an informed tradeoff and a surprise bill.

## Observability finds the bug. It can't tell us the answer is good

Everything above has a limit. Instruments tells us _where_ the time went and _whether_ a particular trace broke. It cannot tell us whether the tags our feature generated are _good_ across a thousand inputs. A feature can pass every mechanical check, throw zero errors, run fast, and still be consistently wrong. The silent failure has a second face: an output that is plausible and incorrect.

That hands us off to the second discipline. Observability covers the run in front of us; measurement covers the distribution behind it.

## An evaluation is a statistical unit test

The [Evaluations framework](https://developer.apple.com/documentation/evaluations) (iOS through watchOS 27, all Beta) plugs into Swift Testing, the design decision that makes the whole thing land. No separate harness, no notebook. We write something that looks like a test, run it where our tests already run, and get a pass rate.

An [`Evaluation`](https://developer.apple.com/documentation/evaluations/evaluation) has a few moving parts: a dataset of samples with expected values, a subject (the feature under test), one or more evaluators that each produce a `Metric`, and an aggregation step. A book-tagging feature as a compact evaluation asks the question that counts once output is statistical, how often is the tag count in range:

```swift
struct BookTaggingEvaluation: Evaluation {
    let tagCount = Metric("TagCount")

    var dataset = ArrayLoader(samples: [
        ModelSample(prompt: "okay I am OBSESSED...",
                    expected: BookTags(tags: ["classic", "romance", "wit", "regency"]))
    ])

    // The subject: run the tagging feature the same way the app does.
    func subject(from sample: ModelSample<BookTags>) async throws -> ModelSubject<BookTags> {
        let session = LanguageModelSession(instructions: "Generate tags for this book based on the review.")
        let response = try await session.respond(to: sample.prompt, generating: BookTags.self)
        return ModelSubject(value: response.content)
    }

    var evaluators: Evaluators {
        Evaluator { _, subject in
            let count = subject.value.tags.count
            return (3...8).contains(count)
                ? tagCount.passing(rationale: "\(count) tags")
                : tagCount.failing(rationale: "Got \(count), expected 3–8")
        }
    }

    func aggregateMetrics(using aggregator: inout MetricsAggregator) {
        aggregator.computeMean(of: tagCount)  // mean of pass/fail == pass rate
    }
}
```

The mental shift is in the last line. The mean of a pass/fail metric is a pass rate, so aggregation turns "did this one sample pass" into "what fraction of the dataset passes." That number is what we assert. The [`.evaluates`](https://developer.apple.com/documentation/evaluations/evaluationtrait) trait runs the evaluation inside a Swift Testing test, and `EvaluationContext.current.result` hands us the result to make a claim about it:

```swift
@Test("Book Tag Evaluations", .evaluates(evaluation))
func evaluateBookTagging() async throws {
    let result = EvaluationContext.current.result
    // Below 80% pass rate, the test fails. A signal, not a vibe.
    #expect(result.aggregateValue(.mean(of: evaluation.tagCount)) >= 0.8)
}
```

That `#expect` line carries the whole "decide by data" argument. The feature has a quality bar, the bar is a number, and the number lives in CI, where the next prompt tweak or OS model update can't slip past it unnoticed. Because the eval runs as an ordinary test, a regression in tagging quality blocks a merge the same way a broken function would.

## Hill climbing is red, green, refactor for AI

Apple's docs name the improvement loop the [_evaluation-driven development life cycle_](https://developer.apple.com/documentation/evaluations/designing-effective-evaluations): run the eval, read the rationale on the failures, make _one_ change, re-run, keep what raised the score. Apple's WWDC26 session on the framework reaches for the machine-learning term for the same move, _hill climbing_, and the analogy to test-driven development holds once it clicks. The pass rate is the failing test, the prompt or schema tweak is the implementation, the re-run is going green.

The Book Tracker sample carries a demonstration that doubles as a warning. The tagging feature passes only 50% of the time, so we make exactly one change, a `.count(3...8)` guide on the `@Generable` type telling the model how many tags to produce:

```swift
@Generable
struct BookTags: Codable {
    @Guide(
        description: "Descriptive tags capturing themes, genres, moods, and topics",
        .count(3...8)  // the one-line hill-climbing change
    )
    var tags: [String]
}
```

TagCount jumps from 50% to 100%, and the win looks total. The same change introduced a regression, though: the model now returns _exactly eight tags every time_, gaming the count constraint at the expense of relevance. This one diff makes the entire case for evaluations. A manual spot-check sees the count is in range and moves on; a good eval suite, with a metric watching for the degenerate case, catches the regression we created while fixing the bug we had. Eyeballing the output would have missed it.

## The trap: every metric green, the output wrong

Heuristic metrics have a ceiling, and the next case sits right on top of it. Picture an Alice in Wonderland sample where the model returns six well-formed tags: "overrated," "pretentious," "whodunit," and three more. Count is in range. Every tag is a real, genre-bearing word. Every heuristic metric is green. The output is still wrong, because those tags describe the _reader's opinion_ of the book, not the book itself. "Passing metrics, wrong output" marks the ceiling of code-based checks: a heuristic can verify shape, count, and format, but it cannot verify meaning. Grading meaning needs a grader that understands meaning.

## Model-as-judge, the typed Apple version

The answer the field landed on is using a model to grade a model, and Apple's version is more disciplined than the prompt-grading scripts most teams hand-roll. A [`ModelJudgeEvaluator`](https://developer.apple.com/documentation/evaluations/modeljudgeevaluator) is another `Evaluator` producing the same `Metric` type, so it composes with the code-based checks already in the suite. We do not run two systems, we add one evaluator:

```swift
ModelJudgeEvaluator(
    "TagQuality",
    scale: .numeric([
        4: "Tags are relevant and helpful for browsing",
        3: "Mostly relevant, one tag too vague or generic",
        2: "Several tags are wrong or generic",
        1: "Unhelpful or irrelevant"
    ]),
    judge: SystemLanguageModel.default  // any judge at least as capable as the subject
)
```

A few design choices earn the credit. The scale is _even-numbered_, 1 through 4, with no neutral middle, so the judge can't cop out to "3 out of 5" the way human and machine graders both lean toward. Apple's docs put it directly: an even number "removes the noncommittal middle the model as judge can otherwise default to." The other rule is that the judge be at least as capable as the subject; Apple's own example uses `SystemLanguageModel.default`, and a developer who wants the stronger grader can pass [the Private Cloud Compute model](/posts/foundation-models-private-cloud-compute/) instead, a choice that satisfies the rule rather than a framework requirement. When a question is too broad ("is this tag good?"), [`ScoreDimension`](https://developer.apple.com/documentation/evaluations/scoredimension) splits it into independent axes, accuracy versus usefulness, scored separately, and a [`ModelJudgePrompt`](https://developer.apple.com/documentation/evaluations/modeljudgeprompt) gives the judge context about our specific app through its instructions, an `evaluationTarget`, and a `reference`. The single-metric initializer also takes a `scoringMode:`, and multi-dimension and pairwise variants exist, so the surface is broader than the three-argument form suggests.

One caveat the credit should not bury: a model judge is still a model. It costs real compute, on-device or PCC, every time the suite runs, and it adds nondeterminism back into the test suite we built to manage nondeterminism. A typed, structured judge grades better than a hand-rolled prompt, but it does not grade deterministically. The honest mitigation Apple documents is calibration: score a small set with human reviewers, compare, and refine the criteria where the judge systematically disagrees.

## Grade the journey, not only the destination

For agentic features there is one more layer, and it ties back to the silent failure we opened with. A plausible final answer can come from the wrong path: the right tool with wrong arguments, the wrong tool by luck, or a state-changing tool fired during what should have been a read-only query. To catch that, we evaluate the _trajectory_, the sequence of tool calls, not only the output.

Apple's [tool-calling evaluation article](https://developer.apple.com/documentation/evaluations/evaluating-tool-calling-behavior) uses a home-automation example that shows the move clearly. A [`TrajectoryExpectation`](https://developer.apple.com/documentation/evaluations/trajectoryexpectation) asserts which tools should be called, in what order, and which tools must _never_ be called:

```swift
ModelSample(
    prompt: "What's the current temperature?",
    expectations: TrajectoryExpectation(
        ordered: [ToolExpectation("get_thermostat")],
        disallowed: [                       // a read-only query must never change state
            ToolExpectation("set_thermostat"),
            ToolExpectation("set_lights")
        ]
    )
)
```

That `disallowed` list is a safety property expressed as a test. "Answering a temperature question must not change the thermostat" is the kind of invariant no output check would catch, because the answer can be correct while the side effect is a disaster. Argument values get checked through [`ArgumentMatcher`](https://developer.apple.com/documentation/evaluations/argumentmatcher), which Apple's docs describe as providing nine validation strategies, from strict `.exact` equality through `.oneOf`, `.range`, and `.contains` for fuzzier matches. A [`ToolCallEvaluator`](https://developer.apple.com/documentation/evaluations/toolcallevaluator) then folds these trajectory checks into the same suite as the output checks, emitting both a strict `ToolsAllPass` metric and a partial `ToolsPercentagePass`, so the path and the answer get graded side by side.

Apple's docs report that the LetterCount example lifts mean exact-match from 58% to 100% by giving the model a counting tool: the trajectory story in miniature. The path was the problem, and grading the path is how we find that out. This is also where the two halves of the post meet. The silent-failure bug from earlier, a referenced tool missing from the body, is exactly the kind of thing a trajectory expectation turns into a repeatable check: assert that `switchToTutorialMode` runs once the user confirms a craft, and a build that drops the tool fails the evaluation instead of shipping a model stuck in a loop. The instrument finds it once, and the expectation keeps it found.

## The pre-flight checklist

Strip away the API tour and a working argument sits underneath. Before an agentic Foundation Models feature ships, work this list in order. It threads both tools together: profile to see the run, evaluate to trust the distribution.

1. Profile one real trace, and confirm the instruction set switches when the design says it should and that no inference failed silently. "It worked" is not a finding.
2. Confirm every tool referenced in the instruction text is present in the same `body`.
3. Budget Time to First Token, and trim the schema with `includeSchemaInPrompt: false` once it is established.
4. Write 20 to 30 focused seed samples that span the genres, tones, and edge cases that matter.
5. Score with code heuristics first; add a model judge only where quality is describable but not measurable.
6. Assert a pass-rate target with `#expect` so the bar lives in CI.
7. Expand beyond the hand-written set before trusting the numbers, and expect the scores to drop.

The last point needs spelling out. A tiny hand-written dataset leans toward the cases we already thought of, so Apple ships [`makeSamples`](https://developer.apple.com/documentation/evaluations/generating-synthetic-evaluation-datasets), which grows a seed set into a larger one and takes a `validator` closure to reject any synthetic sample that breaks our rules. When the demo runs against the larger set, the scores _drop_, and that drop is the good outcome: the bigger set exercised weaknesses the small one never reached.

## The new definition of done

What Apple got right is mostly about _activation energy_: both tools are native, Instruments and Swift Testing, with no new harness to stand up, and both work with any model the framework supports. The tension is real too, and pretending otherwise would be the vibes-based thinking this post argues against. Model judges and synthetic-data generation cost real compute and add nondeterminism back in. The demo numbers are beta, single-device, and not benchmarks. And none of this makes AI features deterministic. It makes their unreliability _measurable_. That is the win, a big one, and it is a different win than "now they're reliable." Conflating the two is how teams get surprised in production.

So for a normal feature, done means the tests pass. For a Foundation Models feature, done has three parts, and missing any one is how the silent failures we started with reach users.

You can _see_ the loop, the tool-call hierarchy and where the latency lives, through Instruments. You can put a _number_ on quality, a pass rate from the Evaluations framework that survives the move from "looked good when I tried it" to "scores above the bar across the dataset." And you assert that number in CI, so the next prompt edit or OS model update can't regress the feature past the bar you set without the build going red. Observability for the run in front of you, measurement for the distribution behind it, and an assertion that keeps both honest over time.

For the scaffolding underneath all of this, the [year-two reframe of Foundation Models](/posts/wwdc26-foundation-models-year-two/) maps the whole release, [Dynamic Profiles and dynamic instructions](/posts/foundation-models-dynamic-profiles/) cover the agent primitives these tools are built to debug, and the [PCC deep dive](/posts/foundation-models-private-cloud-compute/) covers the server model that judges and reasoning lean on. For the from-scratch version of [the agent loop](/posts/s01-the-agent-loop/) and [tool dispatch](/posts/s02-tool-dispatch/) this tooling is built around, the agent series builds it by hand.

The one line to carry out of here: stop shipping AI features on vibes. The tools to do better now live in the IDE you already use. Thanks for reading!
