---
title: "I Built a Coding Agent From Scratch in Swift. Here's What I Missed Until I Read Koog."
ogTitle: "I Built a Coding Agent From Scratch in Swift. What I Missed Until I Read Koog."
ogImageVersion: "2"
author: "Ivan Magda"
pubDatetime: 2026-04-22T03:00:00Z
modDatetime: 2026-04-23T10:19:27Z
slug: "koog-s01-foundation"
featured: true
draft: false
tags:
  - ai-agents
  - kotlin
  - koog
  - swift
  - architecture
description: "After nine posts building a Claude Code-style agent by hand in Swift, I opened up JetBrains Koog framework and realized how much of what I'd hand-rolled was already someone else's problem. Here's what the framework gave me for free, and what it changed about how I think about agents."
---

Earlier this year I wrapped up a nine-part series that rebuilds Claude Code in Swift, from scratch, stage by stage. By the end of the series we had a real coding agent: an agent loop, file tools, shell execution, task tracking, context compaction, background processes. All of it written by hand, all of it working.

The natural sequel question is what I'd do differently if I were starting over. Not on a different day with the same stack. On a different stack entirely.

So I opened up [Koog](https://github.com/JetBrains/koog), JetBrains open-source framework for building agents on the JVM, and spent some time reading it the way we read a codebase written by someone smarter than us. The thing I expected to find was a competing architecture. What I actually found was a set of problems I hadn't realized I was solving badly, dressed in names I didn't have.

This post is the first in a new series about what that experience looked like. Not a framework tour. A set of gaps I didn't know I had, and what a well-designed framework does about them.

---

## The tension we need to resolve first

The Swift series argued that Claude Code works because of architectural restraint. A small set of excellent tools. Thin orchestration. Heavy reliance on the model. The loop is the invariant, tools are the variable. Build the minimum, trust the model to handle the rest.

Koog, at first glance, looks like the opposite. Typed strategy graphs. Mandatory verification steps. Structured outputs instead of free-form text. Explicit persistence. Formal observability. It reads like a framework built for people who don't trust the model.

That looks like a contradiction until we notice who each one is for. Claude Code is a generalist agent running on a developer's laptop. When it's wrong, the developer sees the wrong thing and asks for a retry. The cost of a mistake is a wasted minute. Koog is built for agents that run inside production systems, where a wrong tool call might book a car service appointment or commit a fix to main. The cost of a mistake can be measured in dollars or incidents.

So the two philosophies live on the same axis. Start thin because the mechanism is the first thing to understand. Add structure when the cost of being wrong crosses a threshold. The Swift series taught the first half. This series is about the second.

In this first post, let's stay on the foundation layer. The tools. The loop. The agent as a type. What the Swift series built by hand, and what a framework like Koog hands us on day one. The heavier ideas (strategy graphs, typed subtasks, observability, history compression) each get their own post later in the series.

---

## What we built by hand in Swift

Let's recap what was in our Swift agent by the end of the foundation stages. Nothing exotic. The same set of tools any Claude Code clone needs to exist.

We wrote a `ReadTool` that took a path and a line range, streamed the file, detected binary content, and formatted the result for the model. A `WriteTool` that created parent directories, handled overwrites, returned a structured result. An `EditTool` that applied a single exact-match patch and failed loudly when the match was ambiguous. A `ListTool` that walked directories with glob filters. A `BashTool` that spawned a process with a timeout backed by SIGINT, captured stdout and stderr, and returned a typed result distinguishing success from the various flavors of failure.

None of those were hard individually. What added up was the ceremony around them. Each tool needed a hand-written JSON schema for its parameters, because that's what the Anthropic API expects. Each tool needed a `Sendable` conformance so it could be called from anywhere. The agent itself had a dispatch map: a giant switch that looked at the tool name from the model's response and routed to the right handler. Errors needed a consistent shape so the model could understand why a call failed. The loop needed a config object to govern max iterations, timeouts, and stop conditions.

By the time the foundation tools were in place, the `Agent.swift` file had grown to several hundred lines, and the majority of it was plumbing. Schema construction. Dispatch. Error envelopes. Timeout handling. The actual decisions (which tools to ship, what their error contracts were, what the system prompt said) were a smaller fraction than I would have guessed.

That fraction is the thing I want to talk about.

---

## The same foundation in Koog

Here's what a foundation coding agent looks like in Koog. Before any code, let's walk the mental model.

A `ToolRegistry` is a typed container of tools the agent can call. Koog ships a set of built-in file tools that cover most of what we wrote in Swift: `ReadFileTool`, `WriteFileTool`, `EditFileTool`, `ListDirectoryTool`. Each one takes a file-system provider at construction time, which is Koog's way of saying "here is the root I'm allowed to read from and write to." Registering a built-in tool is one line inside a `ToolRegistry { ... }` block.

Custom tools come in two flavors. Class-based tools, where we subclass `Tool<Args, Result>` with a serializable args type, a serializable result type, and a `descriptor` that names the tool and describes what it does. And annotation-based tools, where we mark a plain function with `@Tool` and `@LLMDescription` and register it as a function reference. The annotation path is what we want for a single utility like a bash command runner.

The schema is never hand-written. It's derived from the Kotlin types by reflection and `@Serializable`. The dispatch is never hand-written. The registry knows how to route a tool call to its implementation. The tool descriptions, meaning the text the model actually reads when deciding whether to call a tool, come from `@LLMDescription` annotations on the function and each parameter, which means the thing the model sees and the thing the compiler sees are the same object.

The agent itself is a single type, `AIAgent`, constructed with a prompt executor, a model, a system prompt, and a tool registry. The loop (LLM request, tool call, tool result, LLM request, repeat) is Koog's default basic strategy. It runs until the model stops asking for tool calls and returns a string. A `maxIterations` parameter caps it at 50 by default, which is Koog's version of the stop condition we wrote by hand.

None of this is magic. It's the same shape of agent we built in Swift. The difference is that the plumbing has a home.

---

## A minimal foundation agent in Koog

Let's assemble one. We'll need Koog on the classpath, an Anthropic API key in `ANTHROPIC_API_KEY`, and a place to run code.

```kotlin
dependencies {
    implementation("ai.koog:koog-agents:0.8.0")
}
```

We start with the one custom tool we need. Koog's built-ins cover files, and the `agents-ext` module also ships an `ExecuteShellCommandTool` with user-approval and timeout handling built in. For our minimal example let's write the shell tool ourselves, because a custom `@Tool` function is the shape we'll reach for most often when wiring agents to whatever our project actually needs. The `ExecuteShellCommandTool` is worth knowing about for the day we want approval flows and platform-specific executors; for now, here's the minimal path.

```kotlin
@Tool
@LLMDescription("Execute a shell command and return its combined stdout and stderr.")
suspend fun bash(
    @LLMDescription("The shell command to execute.")
    command: String,
    @LLMDescription("Timeout in seconds. Defaults to 30.")
    timeoutSeconds: Int = 30
): String = withContext(Dispatchers.IO) {
    val process = ProcessBuilder("/bin/sh", "-c", command)
        .redirectErrorStream(true)
        .start()
    try {
        if (process.waitFor(timeoutSeconds.toLong(), TimeUnit.SECONDS)) {
            process.inputStream.bufferedReader()
                .use { it.readText() }
                .ifEmpty { "(no output)" }
        } else {
            "Error: command timed out after ${timeoutSeconds}s."
        }
    } catch (e: Exception) {
        "Error: ${e.message ?: "Process execution failed"}"
    } finally {
        if (process.isAlive) process.destroyForcibly()
    }
}
```

The two annotations do the work. `@Tool` marks the function as callable by the model. `@LLMDescription` provides the text the model actually reads when deciding whether to call it, both for the function and each parameter. The return type is `String`, which Koog wraps as the tool result. The timeout is a default parameter, not a config object. That's one file. No schema, no dispatch entry, no envelope type.

With the tool defined, the agent is a single expression.

```kotlin
val agent = AIAgent(
    promptExecutor = simpleAnthropicExecutor(System.getenv("ANTHROPIC_API_KEY")),
    systemPrompt = """
        You are a coding agent operating in a Unix-like environment.
        You have file tools and a bash tool. Prefer reading before writing.
        Keep edits small and verify changes with follow-up reads.
    """.trimIndent(),
    llmModel = AnthropicModels.Sonnet_4_5,
    toolRegistry = ToolRegistry {
        tool(ReadFileTool(JVMFileSystemProvider.ReadOnly))
        tool(ListDirectoryTool(JVMFileSystemProvider.ReadOnly))
        tool(WriteFileTool(JVMFileSystemProvider.ReadWrite))
        tool(EditFileTool(JVMFileSystemProvider.ReadWrite))
        tool(::bash)
    },
    maxIterations = 25
)
```

The `simpleAnthropicExecutor` is Koog's convenience factory for the Anthropic provider. `AnthropicModels.Sonnet_4_5` is a typed model constant, which means we get compile-time safety on the model name and the framework knows what that model's capabilities are. The tool registry uses a DSL block: one call to `tool(...)` per entry, some of which are built-in file tools parameterized by a file-system provider, and one of which is our `bash` function passed by reference.

`maxIterations = 25` is our stop condition. In the Swift series we hand-rolled an iteration counter with a configurable max; here it's a named parameter on the constructor.

Running it is one line.

```kotlin
fun main() = runBlocking {
    val result = agent.run(
        "Find any TODO comments in the src directory and list them with file paths."
    )
    println(result)
}
```

And that's the whole agent. About thirty lines of code including imports, covering everything we spent the first three or four stages of the Swift series building. The model will call `list_directory`, walk into `src`, call `bash` with a `grep -rn TODO src` (or something similar), and return a structured answer. If we want to see what tools it calls along the way, Koog gives us an event handler hook inside the agent constructor.

```kotlin
handleEvents {
    onToolCallStarting { context ->
        println("-> ${context.toolName}(${context.toolArgs})")
    }
}
```

That's one side of what the Swift series called tracing, and it's four lines.

---

## What actually disappeared, and what didn't

Looking at the Koog example next to what we built, a specific list of things is gone.

The hand-written JSON schemas are gone. Every tool parameter we wrote in Swift had a matching schema block describing its type, whether it was required, and what it meant. Koog derives that from the Kotlin types and `@LLMDescription` annotations, and the derivation happens in one place rather than being scattered across each tool file.

The dispatch map is gone. The tool registry routes a name to an implementation without us writing a switch statement. This matters more than it looks, because the dispatch is the exact place where adding a new tool in a hand-rolled agent tends to accidentally go wrong: wiring the name, forgetting to update the schema, registering the wrong handler.

The `Sendable` ceremony is gone, because Kotlin's model for concurrency is different from Swift's, and the framework takes care of what little ceremony remains. The tool-result envelope is gone: Koog handles the structured serialization based on the return type.

The shell-timeout implementation is still there, because we wrote it. Koog's `ExecuteShellCommandTool` would have handled both the timeout and a user-approval flow for us, but the custom `@Tool` path kept the example closer to what we'd write ourselves in a real project. Either way, it's a handful of lines of IO code, not a subsystem.

Here's what didn't disappear. The decision to ship those specific tools. The scope each tool has (read-only versus read-write file-system providers). The error contracts the model sees. The system prompt. The iteration cap. The choice of model. Every decision worth making in a coding agent survived the translation. The only things that disappeared were the things that never deserved to be decisions in the first place.

I spent stages of the Swift series writing plumbing that would have been one annotation in a typed DSL. The reason it felt like work was that I was solving problems the framework had already solved.

---

## What I'd still build by hand, what I'd stop hand-rolling

The Swift series still makes sense. The loop is the invariant, and we can't sensibly pick a framework-backed architecture if we don't know what the framework is doing. The fastest way to understand an agent loop is to write one, tool call by tool call, with nothing between us and the HTTP request. That's pedagogy, and it doesn't go away because a framework exists.

What I'd stop hand-rolling, in any agent I ship past a personal prototype, is the plumbing that Koog absorbed in the example above. Schema construction. Dispatch. The envelope around tool results. The concurrency ceremony. Each one is a handful of lines, but those lines multiply with every new tool, and the bugs in them tend to be discovered through the model's confusion rather than through a crash.

The other thing I'd stop doing is treating observability as a feature I'll add later. Koog builds it in from the first agent we write. That's the subject of a later post in this series, not this one, but the habit starts in the foundation.

---

## What's next in this series

The foundation is the easiest part. The posts that follow go where Koog earns its weight.

Next, let's turn the ad-hoc tool loop from this example into an explicit strategy graph, with a real verification step and a retry edge. This is the architectural idea that separates Koog from most other agent libraries, and it's where the "prompts are not guardrails" thesis actually gets built in code.

From there, let's take on typed subtasks: how forcing the agent to return a `ProblemsDescriptor` instead of a free-form verdict changes what the agent is even able to say. Then observability and history compression together, because production agents need both and they're easier to motivate side by side. And at some point let's look at composing Koog with external agents like Claude Code over ACP, because frameworks and CLI agents aren't mutually exclusive.

---

Building the agent by hand taught me how the machine works. Reading Koog taught me which parts of that machine were mine to design and which parts were never anyone's business to write twice. If you followed the Swift series, the foundation in this post will feel like a compression of the first three or four stages into a single file, and that compression is the thing worth noticing. The next posts are about what you get to think about when the compression frees up the attention.

If you want the code that kept me honest while writing this, the Swift series lives in [swift-claude-code](https://github.com/ivan-magda/swift-claude-code), and the Koog repo with its basic code-agent example is at [JetBrains/koog](https://github.com/JetBrains/koog). See you in the next post.
