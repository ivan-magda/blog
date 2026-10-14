---
title: "Why my Swift debouncer got 50× faster and what the Swift Runtime has to do with it"
author: "Ivan Magda"
pubDatetime: 2026-10-13T21:00:45Z
slug: "swift-debounce-runtime-investigation"
featured: false
draft: false
tags:
  - swift
description: "A Swift debounce investigation through task reuse, runtime metadata, generic specialization, lock placement, and callback latency."
---

I started with [Side Effect's article on debouncing with Swift concurrency](https://sideeffect.io/posts/2023-01-11-regulate/). It replaces a task created for each input with one task that handles a whole burst of events, such as the keystrokes you type before pausing in a search field. New values update the pending value and deadline while the worker sleeps.

I wanted to measure how much work that saved. The comparison led from task creation to the cost of a lock, then into `ContinuousClock.Instant`, runtime metadata, and generic code across a module boundary. Later, moving the lock in memory improved the debouncer while making the raw-lock benchmark worse.

The resulting package accepted values at **16 ns per send**, compared with **798 ns** for the task-per-value reference, in a 100,000-value burst on one thread. That roughly 50× improvement measures the amortized cost of the synchronous input path.

_Code excerpts and saved results use [swift-debounce at revision `990cf04`](https://github.com/ivan-magda/swift-debounce/tree/990cf04587cf922748c13876d2843071c22873fa). The recorded environment was an M1 Max with 10 CPU cores, macOS 26.7.1, Swift 6.4, and release builds, on October 13, 2026._

## One task per burst was only the beginning

Let's start with trailing debounce. A search field produces several intermediate queries before we pause. Each value replaces the pending query and moves its deadline forward; after the quiet period, the action receives the latest value.

The [task-per-value implementation](https://github.com/ivan-magda/swift-debounce/blob/990cf04587cf922748c13876d2843071c22873fa/Benchmarks/Sources/References/ReferenceDebouncers.swift#L61-L77) cancels the previous task, then creates a replacement that sleeps before delivering its captured value. Inside the lock, the core logic looks like this:

```swift
task?.cancel()
task = Task {
    do {
        try await Task.sleep(for: dueTime)
        await output(value)
    } catch {
        // Cancellation ends this task without delivering a value.
    }
}
```

Most values in a dense burst never reach `output`, but their tasks still have lifecycles to finish. Cancellation is cooperative: calling `cancel()` records a request, and the sleeping task responds to it. Creating a Swift task also does not imply creating a dedicated operating-system thread. The extra work here comes from creating and cancelling tasks that will deliver no value.

Side Effect's alternative keeps the latest value and deadline outside the sleeping task. The first input starts a worker. Later inputs update shared state, and the worker consults that state when it wakes.

<figure class="research-figure">
  <a class="figure-light" href="/images/swift-debounce-runtime-investigation/01-task-timeline.svg"><img src="/images/swift-debounce-runtime-investigation/01-task-timeline.svg" alt="A burst creates and cancels a task for each value in one implementation; the other keeps one worker and extends its deadline." width="720" height="548" loading="lazy" decoding="async" /></a>
  <a class="figure-dark" href="/images/swift-debounce-runtime-investigation/01-task-timeline-dark.svg"><img src="/images/swift-debounce-runtime-investigation/01-task-timeline-dark.svg" alt="A burst creates and cancels a task for each value in one implementation; the other keeps one worker and extends its deadline." width="720" height="548" loading="lazy" decoding="async" /></a>
</figure>

_Task lifetimes and deadline updates based on the [two reference implementations](https://github.com/ivan-magda/swift-debounce/blob/990cf04587cf922748c13876d2843071c22873fa/Benchmarks/Sources/References/ReferenceDebouncers.swift) and [Side Effect's algorithm](https://sideeffect.io/posts/2023-01-11-regulate/). A worker can wake more than once during a burst._

The [long-lived reference's `emit` method](https://github.com/ivan-magda/swift-debounce/blob/990cf04587cf922748c13876d2843071c22873fa/Benchmarks/Sources/References/ReferenceDebouncers.swift#L137-L157) first asks the state machine whether it needs a new worker. Most calls in a burst stop at the guard. The worker follows an updated deadline by sleeping again:

```swift
public func emit(value: T) {
    let (shouldStartWorker, initialDeadline) = stateMachine.apply { machine in
        machine.newValue(value)
    }

    guard shouldStartWorker else {
        return
    }

    let worker = Task { [stateMachine, output] in
        var deadline = initialDeadline

        while true {
            try? await Task.sleep(until: deadline, clock: .continuous)

            let nextStep = stateMachine.apply { machine in
                machine.sleepIsOver()
            }

            switch nextStep {
            case .finishDebouncing(let latestValue):
                await output(latestValue)
                return
            case .continueDebouncing(let newDueTime):
                deadline = newDueTime
            }
        }
    }

    task.set(stored: worker)
}
```

An input does not have to wake the worker to extend the deadline. At its earlier deadline, the worker discovers the update and continues waiting. Repeated input now requires a clock read and a state update under a lock, without creating another task.

In the standardized comparison, each round sent 100,000 integer values in a tight loop on one thread, with a 10 ms quiet period. Both references delivered the final value once:

<figure class="research-figure">
  <a class="figure-light" href="/images/swift-debounce-runtime-investigation/14-task-reuse-comparison.svg">
    <picture>
      <source media="(max-width: 640px)" srcset="/images/swift-debounce-runtime-investigation/14-task-reuse-comparison-mobile.svg" width="360" height="612" />
      <img src="/images/swift-debounce-runtime-investigation/14-task-reuse-comparison.svg" alt="Reusing one task reduces synchronous send cost from 798 to 216 ns per input and total process CPU from 280.81 to 21.91 ms for 100,000 values." width="720" height="560" loading="lazy" decoding="async" />
    </picture>
  </a>
  <a class="figure-dark" href="/images/swift-debounce-runtime-investigation/14-task-reuse-comparison-dark.svg">
    <picture>
      <source media="(max-width: 640px)" srcset="/images/swift-debounce-runtime-investigation/14-task-reuse-comparison-mobile-dark.svg" width="360" height="612" />
      <img src="/images/swift-debounce-runtime-investigation/14-task-reuse-comparison-dark.svg" alt="Reusing one task reduces synchronous send cost from 798 to 216 ns per input and total process CPU from 280.81 to 21.91 ms for 100,000 values." width="720" height="560" loading="lazy" decoding="async" />
    </picture>
  </a>
</figure>

<details class="research-data">
  <summary>View data<span class="sr-only">: Task reuse comparison</span></summary>

<div data-table-scroll style="overflow-x: auto" tabindex="0" role="region" aria-label="Task reuse comparison">

| Reference       | Amortized synchronous send cost | Total process CPU |
| --------------- | ------------------------------: | ----------------: |
| Task per value  |                          798 ns |         280.81 ms |
| Long-lived task |                          216 ns |          21.91 ms |

</div>

</details>

_Median of 15 rounds in the recorded M1 Max release environment. [Scenario results](https://github.com/ivan-magda/swift-debounce/blob/990cf04587cf922748c13876d2843071c22873fa/Benchmarks/results/2026-10-13/scenarios.md). Send cost divides the input loop's wall time by its number of calls. CPU covers a longer window, including output and a settling period for cancelled tasks._

The reference counters recorded 100,000 tasks for the first strategy and one for the second. The larger reduction in CPU is consistent with work continuing outside the synchronous calls, including cancellation cleanup.

The implementations handle long-running actions differently: the reference allows actions to overlap, while the package runs them one at a time. This benchmark sends a single burst and checks that the final value is delivered once.

The long-lived reference still spent 216 ns accepting each value. Each input acquired the state lock, computed a deadline, and replaced the pending value.

## Replacing the lock saved about ten nanoseconds

The long-lived reference uses `NSRecursiveLock`. A cheaper lock was a reasonable next experiment: even an input that starts no task must enter the critical section.

The historical prototype comparison measured the primitive around a counter increment, then the complete emit method. It has its own workload and starting point:

<figure class="research-figure">
  <a class="figure-light" href="/images/swift-debounce-runtime-investigation/04-lock-hypothesis.svg">
    <picture>
      <source media="(max-width: 640px)" srcset="/images/swift-debounce-runtime-investigation/04-lock-hypothesis-mobile.svg" width="360" height="588" />
      <img src="/images/swift-debounce-runtime-investigation/04-lock-hypothesis.svg" alt="Replacing NSRecursiveLock with os_unfair_lock reduces the raw operation from 17.1 to 8.0 ns and the historical prototype’s complete emit from 188.0 to 177.7 ns." width="720" height="620" loading="lazy" decoding="async" />
    </picture>
  </a>
  <a class="figure-dark" href="/images/swift-debounce-runtime-investigation/04-lock-hypothesis-dark.svg">
    <picture>
      <source media="(max-width: 640px)" srcset="/images/swift-debounce-runtime-investigation/04-lock-hypothesis-mobile-dark.svg" width="360" height="588" />
      <img src="/images/swift-debounce-runtime-investigation/04-lock-hypothesis-dark.svg" alt="Replacing NSRecursiveLock with os_unfair_lock reduces the raw operation from 17.1 to 8.0 ns and the historical prototype’s complete emit from 188.0 to 177.7 ns." width="720" height="620" loading="lazy" decoding="async" />
    </picture>
  </a>
</figure>

<details class="research-data">
  <summary>View data<span class="sr-only">: Lock replacement comparison</span></summary>

<div data-table-scroll style="overflow-x: auto" tabindex="0" role="region" aria-label="Lock replacement comparison">

| Operation, one thread             | `NSRecursiveLock` reference | `os_unfair_lock` variant |
| --------------------------------- | --------------------------: | -----------------------: |
| Lock, increment a counter, unlock |                     17.1 ns |                   8.0 ns |
| Complete emit method              |                    188.0 ns |                 177.7 ns |

</div>

</details>

_Historical [prototype lock experiment](https://github.com/ivan-magda/swift-debounce/blob/990cf04587cf922748c13876d2843071c22873fa/Benchmarks/results/prototype-locks.md), with one million emits for the full-method comparison. Its 188 ns baseline is separate from the 216 ns standardized scenario above._

The isolated operation became less than half as expensive. The useful method saved 10.3 ns, about 5.5%. That was close to the raw lock's 9.1 ns saving, leaving most of the method's cost intact.

Under contention, the lock choice also changed the resources spent accepting values. With eight threads sending 100,000 values each, the reference used 2,551.5 CPU ns per emit and recorded 33,048 context switches. The unfair-lock variant used 1,384.4 CPU ns and recorded 13,924 switches, while wall time per emit moved from 376.6 to 342.1 ns. These aggregate measurements show how CPU and elapsed time can respond by different amounts; they are not individual-call latency distributions.

For the single-thread path, changing the primitive had accounted for only a small part of the cost. I moved on to the clock read and state update performed around the lock.

## Following the deadline into the Swift Runtime

The reference carries its deadline through more than a clock getter. It stores the instant in an enum case alongside the generic payload, then returns an instant from the method that updates that state. The beginning of the [state declaration](https://github.com/ivan-magda/swift-debounce/blob/990cf04587cf922748c13876d2843071c22873fa/Benchmarks/Sources/References/ReferenceDebouncers.swift#L84-L89), with later members omitted, shows the combination:

```swift
struct DebounceStateMachine<T> {
    enum State {
        case idle
        case debouncing(
            value: T,
            dueTime: ContinuousClock.Instant,
            isValueDuringSleep: Bool
        )
    }

    // Other members omitted.
}
```

Each new input obtains the current time, advances it by the interval, and replaces this enum payload. The [actual `newValue` method](https://github.com/ivan-magda/swift-debounce/blob/990cf04587cf922748c13876d2843071c22873fa/Benchmarks/Sources/References/ReferenceDebouncers.swift#L100-L111) also returns the deadline in a tuple:

```swift
/// Returns whether to start a task, along with the latest deadline.
mutating func newValue(_ value: T) -> (Bool, ContinuousClock.Instant) {
    let dueTime = ContinuousClock.now + duration

    switch state {
    case .idle:
        state = .debouncing(
            value: value,
            dueTime: dueTime,
            isValueDuringSleep: false
        )
        return (true, dueTime)

    case .debouncing:
        state = .debouncing(
            value: value,
            dueTime: dueTime,
            isValueDuringSleep: true
        )
        return (false, dueTime)
    }
}
```

The source gave me several operations to look for: clock acquisition, duration arithmetic, and handling the enum and returned tuple. The saved `sample` output included all of those areas. These are selected observed names, with counts and unrelated entries omitted, rather than a contiguous stack:

```text
DebounceStateMachine.newValue(_:)
OptimizedDebounce.emit(value:)
type metadata accessor for ContinuousClock.Instant
static ContinuousClock.now.getter
ContinuousClock.Instant.advanced(by:)
static Duration.+ infix(_:_:)
__swift_memcpy16_8
__swift_instantiateGenericMetadata
swift_getGenericMetadata
swift_getTupleTypeMetadata3
swift_getTupleTypeMetadata
```

`OptimizedDebounce` was the historical name of the long-lived reference. The [saved profile and compiler observations](/images/swift-debounce-runtime-investigation/historical-observations.txt) preserve the original symbols and compiler experiment. The runtime entries led to a question that the source alone had not made obvious: what does the compiled code know about the deadline's representation?

<figure class="research-figure">
  <a class="figure-light" href="/images/swift-debounce-runtime-investigation/05-runtime-profile.svg"><img src="/images/swift-debounce-runtime-investigation/05-runtime-profile.svg" alt="Selected profile symbols accompany a conceptual path from state containing Instant to type metadata and value witnesses for value operations." width="720" height="536" loading="lazy" decoding="async" /></a>
  <a class="figure-dark" href="/images/swift-debounce-runtime-investigation/05-runtime-profile-dark.svg"><img src="/images/swift-debounce-runtime-investigation/05-runtime-profile-dark.svg" alt="Selected profile symbols accompany a conceptual path from state containing Instant to type metadata and value witnesses for value operations." width="720" height="536" loading="lazy" decoding="async" /></a>
</figure>

_Observed names from the [historical profiles](/images/swift-debounce-runtime-investigation/historical-observations.txt), grouped with an explanation of metadata and value handling. The selection provides no timing shares or proof of a particular generated call chain._

### A concrete type can still have an unknown layout

`ContinuousClock.Instant` names a concrete type. Across a library-evolution boundary, that alone does not let client code assume its physical representation. Swift permits a library to change a non-frozen value type's stored representation while preserving compatibility with existing clients. Those clients must obtain layout information that they cannot bake into their instructions. [`@frozen` publishes stronger layout guarantees](https://www.swift.org/blog/library-evolution/#structs-and-enums), at the cost of those future changes.

The [pinned upstream declaration of `Instant`](https://github.com/swiftlang/swift/blob/c06a182b36451e19ddf17189b872151b7b163dca/stdlib/public/Concurrency/ContinuousClock.swift#L23-L33) has an internal `Duration` field and no `@frozen` attribute. Reading that field in the source does not authorize an independently compiled client to assume it will remain the representation. This upstream revision explains the mechanism; it is not the established source revision of the Apple Swift 6.4 binary used in the profile.

Consider replacing the reference's `.debouncing` case. Generated code needs to locate the payload, handle the old value, and place the new value in its storage. For an opaque value, it cannot assume a fixed size, alignment, or set of copy and destruction operations. Swift's **type metadata** points to a **value witness table** containing those layout facts and value operations. Code that lacks a concrete representation can use that interface to handle the value. A value witness is distinct from a protocol witness, which supplies an implementation of a protocol requirement. The [Swift ABI metadata documentation](https://github.com/swiftlang/swift/blob/c06a182b36451e19ddf17189b872151b7b163dca/docs/ABI/TypeMetadata.rst#L29-L35) describes the metadata-to-table relationship.

The containing enum and tuple also depend on the layouts of their elements, including padding and alignment. Knowing `T == Int` removes uncertainty about the input payload; it does not expose the separate `Instant` representation. Swift's [aggregate layout rules](https://github.com/swiftlang/swift/blob/c06a182b36451e19ddf17189b872151b7b163dca/docs/ABI/TypeLayout.rst#L19-L43) explain why an opaque field can affect the surrounding storage.

This model explains how the short state update can reach metadata accessors, tuple metadata functions, and copy helpers. The selected symbols support investigating that machinery, without assigning a fraction of the method's cost to resilience. In particular, the observed `__swift_memcpy16_8` does not establish a specific value-witness call chain. Metadata lookup also does not imply allocating a fresh metadata record or boxing a deadline on every send; Swift can reuse metadata while code continues to access it on a frequent path.

### Reading the clock is a separate cost

Even with a cheaper stored representation, we still need the current time. A separate clock microbenchmark reported **28.9 ns per iteration** for its `ContinuousClock.now` loop and **5.0 ns** for its `mach_continuous_time()` loop.

The [harness consumes the two results differently](https://github.com/ivan-magda/swift-debounce/blob/990cf04587cf922748c13876d2843071c22873fa/Benchmarks/Sources/Locks/main.swift#L90-L106): each `Instant` goes through `blackHole`, while the integer loop accumulates tick readings and consumes the sum. The numbers therefore describe the saved loops, including their consumption overhead. They cannot isolate two clock instructions or account for all subsequent deadline handling.

<figure class="research-figure">
  <a class="figure-light" href="/images/swift-debounce-runtime-investigation/06-clock-cost.svg"><img src="/images/swift-debounce-runtime-investigation/06-clock-cost.svg" alt="The saved clock loops cost 28.9 ns per iteration for ContinuousClock.now and 5.0 ns for mach_continuous_time." width="720" height="330" loading="lazy" decoding="async" /></a>
  <a class="figure-dark" href="/images/swift-debounce-runtime-investigation/06-clock-cost-dark.svg"><img src="/images/swift-debounce-runtime-investigation/06-clock-cost-dark.svg" alt="The saved clock loops cost 28.9 ns per iteration for ContinuousClock.now and 5.0 ns for mach_continuous_time." width="720" height="330" loading="lazy" decoding="async" /></a>
</figure>

_Single-thread median of seven runs, five million iterations after warm-up, in the M1 Max release environment. [Clock results](https://github.com/ivan-magda/swift-debounce/blob/990cf04587cf922748c13876d2843071c22873fa/Benchmarks/results/2026-10-13/locks.md) and [loop definitions](https://github.com/ivan-magda/swift-debounce/blob/990cf04587cf922748c13876d2843071c22873fa/Benchmarks/Sources/Locks/main.swift#L90-L106)._

I changed the internal deadline to `UInt64` ticks. That gives the state a known integer representation and changes how it acquires time. The resulting package's [clock wrapper](https://github.com/ivan-magda/swift-debounce/blob/990cf04587cf922748c13876d2843071c22873fa/Sources/Debounce/Internal/MonotonicClock.swift#L14-L26) uses continuous-time ticks on Darwin; the other supported branch reads `CLOCK_BOOTTIME` and assembles nanoseconds:

```swift
@usableFromInline
enum _MonotonicClock {
    @inlinable
    @inline(__always)
    static func now() -> UInt64 {
        #if canImport(Darwin)
        return mach_continuous_time()
        #else
        var time = timespec()
        clock_gettime(CLOCK_BOOTTIME, &time)

        let secondsInNanoseconds = UInt64(time.tv_sec) &* 1_000_000_000
        return secondsInNanoseconds &+ UInt64(time.tv_nsec)
        #endif
    }
}
```

Darwin ticks are not necessarily nanoseconds. The package reads the platform timebase once through `mach_timebase_info`. Its numerator and denominator define the scale: `nanoseconds = ticks × numer / denom`. The non-Darwin branch uses a ratio of one to one.

The configured interval converts to ticks during initialization. Repeated sends then read ticks and add that precomputed interval; only a worker preparing to sleep converts the remaining ticks back to nanoseconds. These are the [\_Timebase conversion methods](https://github.com/ivan-magda/swift-debounce/blob/990cf04587cf922748c13876d2843071c22873fa/Sources/Debounce/Internal/MonotonicClock.swift#L35-L62):

```swift
func ticks(fromNanoseconds nanoseconds: Double) -> UInt64 {
    let clampedNanoseconds = min(nanoseconds, Self.maxNanoseconds)
    let ticks = clampedNanoseconds * denom / numer

    return UInt64(max(1, ticks.rounded(.up)))
}

func nanoseconds(fromTicks ticks: UInt64) -> UInt64 {
    let nanoseconds = Double(ticks) * numer / denom
    let clampedNanoseconds = min(nanoseconds, Self.maxNanoseconds)

    return UInt64(clampedNanoseconds.rounded(.up))
}
```

The conversion clamps large intervals and rounds upward, so converting to an integer unit does not truncate the represented wait. An interval retains a minimum of one tick. Moving this work out of repeated sends saves conversion work, while making units and rounding the package's responsibility.

Deadline addition needs an overflow policy too. The [helper](https://github.com/ivan-magda/swift-debounce/blob/990cf04587cf922748c13876d2843071c22873fa/Sources/Debounce/Internal/MonotonicClock.swift#L28-L33) saturates at the largest deadline rather than wrapping a far-future time into the past:

```swift
@inlinable
@inline(__always)
func _deadline(after now: UInt64, adding ticks: UInt64) -> UInt64 {
    let (deadline, didOverflow) = now.addingReportingOverflow(ticks)
    return didOverflow ? .max : deadline
}
```

The worker [converts `deadline - now` when it sleeps](https://github.com/ivan-magda/swift-debounce/blob/990cf04587cf922748c13876d2843071c22873fa/Sources/Debounce/Internal/Pacer.swift#L79-L89). `ContinuousClock` had packaged these concerns behind a portable API; the narrower internal representation now requires platform branches, conversion, and overflow handling.

This experiment changed both clock acquisition and the values carried through state. Synchronization structure and optimizer visibility also changed during the investigation, so the final gain cannot be assigned to replacing `Instant` alone. The next profile still contained runtime metadata work.

## The next profile led across a module boundary

The revised prototype's selected symbols pointed into `FastDebounce.emit` and optional-value handling:

```text
FastDebounce.emit(value:)
closure #1 in FastDebounce.emit(value:)
type metadata accessor for Optional
__swift_instantiateGenericMetadata
swift_getGenericMetadata
mach_continuous_time
```

The deadline now had a known integer layout, but the pending payload remained generic. Code compiled for an arbitrary `Value` must handle `Optional<Value>`, whose representation and value operations depend on that payload. A client passing `Int` knows more than a generic body compiled in another module may be able to use.

An earlier cross-module optimization experiment had barely changed the original reference. I repeated that experiment for the fast prototype to check whether implementation visibility explained the remaining work.

### The same compiler flag produced two different outcomes

The historical release harness toggled `-cross-module-optimization` on its `Debounce` target. Each invocation targeted three seconds, checking time between batches of 10,000 emits. A 3,600-second quiet period kept callback delivery outside the repeated-input workload. The [saved output](/images/swift-debounce-runtime-investigation/historical-observations.txt) contains one listed run per configuration:

<figure class="research-figure">
  <a class="figure-light" href="/images/swift-debounce-runtime-investigation/08-cmo-experiment.svg">
    <picture>
      <source media="(max-width: 640px)" srcset="/images/swift-debounce-runtime-investigation/08-cmo-experiment-mobile.svg" width="360" height="590" />
      <img src="/images/swift-debounce-runtime-investigation/08-cmo-experiment.svg" alt="Cross-module optimization changes the fast prototype from 27.58 million to 257.9 million emits per target three-second run, while the original reference remains near 15.7 million." width="720" height="470" loading="lazy" decoding="async" />
    </picture>
  </a>
  <a class="figure-dark" href="/images/swift-debounce-runtime-investigation/08-cmo-experiment-dark.svg">
    <picture>
      <source media="(max-width: 640px)" srcset="/images/swift-debounce-runtime-investigation/08-cmo-experiment-mobile-dark.svg" width="360" height="590" />
      <img src="/images/swift-debounce-runtime-investigation/08-cmo-experiment-dark.svg" alt="Cross-module optimization changes the fast prototype from 27.58 million to 257.9 million emits per target three-second run, while the original reference remains near 15.7 million." width="720" height="470" loading="lazy" decoding="async" />
    </picture>
  </a>
</figure>

<details class="research-data">
  <summary>View data<span class="sr-only">: Cross-module optimization comparison</span></summary>

<div data-table-scroll style="overflow-x: auto" tabindex="0" role="region" aria-label="Cross-module optimization comparison">

| Historical implementation     | CMO off, emits | CMO on, emits |
| ----------------------------- | -------------: | ------------: |
| Fast prototype                |     27,580,000 |   257,900,000 |
| Original long-lived reference |     15,770,000 |    15,680,000 |

</div>

</details>

The fast prototype completed about 9.35 times as many emits with cross-module optimization enabled. The original reference stayed near 15.7 million. The counts measure throughput over a target window with batched clock checks; they are neither medians nor direct ns-per-call measurements.

The similar metadata symbols had appeared under two different constraints. More visibility into the original reference did not change the external `Instant` layout contract. After moving deadlines to integers, the revised prototype responded to the compiler flag with much higher throughput. That supports investigating specialization of the remaining generic state, rather than treating all metadata entries as one fixed category of overhead.

### Making the concrete payload useful to the optimizer

Consider a client that constructs `Debouncer<Int>`. The client knows `Value == Int`; an unspecialized library method still supports any permitted `Value`. It cannot handle `Optional<Value>` as though it were `Optional<Int>` without the concrete substitution.

**Specialization** creates a version of generic code for a concrete substitution. That can let the optimizer replace generic layout and value handling with operations appropriate for `Int` and its optional. **Inlining** places a function body at a call site, which can expose more operations to optimization. A specialized function may remain a separate call, so these are distinct transformations.

For a package API, `@inlinable` makes a body available to optimization in importing modules. It permits specialization and inlining without forcing either. The compiler may also leave an ordinary call. A method without the attribute is not necessarily unspecialized: build arrangements such as CMO can provide visibility by other means. These permissions are the subject of [SE-0193, Cross-module inlining and specialization](https://github.com/swiftlang/swift-evolution/blob/main/proposals/0193-cross-module-inlining-and-specialization.md).

<figure class="research-figure">
  <a class="figure-light" href="/images/swift-debounce-runtime-investigation/07-module-boundary.svg"><img src="/images/swift-debounce-runtime-investigation/07-module-boundary.svg" alt="A client using Debouncer&lt;Int&gt; can see inlinable bodies for send, the clock, locked storage, and the state machine; worker creation remains an ABI-visible call." width="720" height="656" loading="lazy" decoding="async" /></a>
  <a class="figure-dark" href="/images/swift-debounce-runtime-investigation/07-module-boundary-dark.svg"><img src="/images/swift-debounce-runtime-investigation/07-module-boundary-dark.svg" alt="A client using Debouncer&lt;Int&gt; can see inlinable bodies for send, the clock, locked storage, and the state machine; worker creation remains an ABI-visible call." width="720" height="656" loading="lazy" decoding="async" /></a>
</figure>

_Available optimizer information from the [package's send path](https://github.com/ivan-magda/swift-debounce/blob/990cf04587cf922748c13876d2843071c22873fa/Sources/Debounce/Debouncer.swift#L99-L107) and helper declarations. The diagram follows [SE-0193's visibility rules](https://github.com/swiftlang/swift-evolution/blob/main/proposals/0193-cross-module-inlining-and-specialization.md); it does not claim a particular generated specialization._

The package's [public method](https://github.com/ivan-magda/swift-debounce/blob/990cf04587cf922748c13876d2843071c22873fa/Sources/Debounce/Debouncer.swift#L99-L107) exposes the input path. It reads the clock before taking the lock, then asks the state machine whether it needs to start a worker:

```swift
@inlinable
public func send(_ value: Value) {
    let now = _MonotonicClock.now()

    storage.withLock { state in
        let shouldStartWorker = state.machine.send(value, now: now)

        if shouldStartWorker {
            core.startWorker(&state)
        }
    }
}
```

That outer body gives the optimizer little to simplify if the relevant work disappears behind the next call. The clock wrapper already exposes its body. The [storage helper](https://github.com/ivan-magda/swift-debounce/blob/990cf04587cf922748c13876d2843071c22873fa/Sources/Debounce/Internal/LockedStorage.swift#L44-L52) also exposes the critical-section closure's route to the state:

```swift
@inlinable
@inline(__always)
func withLock<Result>(_ body: (inout State) -> Result) -> Result {
    withUnsafeMutablePointers { statePointer, lockElements in
        let lock = lockElements + Self.lockIndex

        _lock(lock)
        defer {
            _unlock(lock)
        }

        return body(&statePointer.pointee)
    }
}
```

The [\_lock and \_unlock helpers](https://github.com/ivan-magda/swift-debounce/blob/990cf04587cf922748c13876d2843071c22873fa/Sources/Debounce/Internal/LockedStorage.swift#L71-L87) expose their platform branches too: `os_unfair_lock` on Darwin, pthread mutexes on the other supported branch. The machine's method then exposes the operation on the generic payload itself.

For an active trailing burst, [\_DebounceMachine.send](https://github.com/ivan-magda/swift-debounce/blob/990cf04587cf922748c13876d2843071c22873fa/Sources/Debounce/Internal/PacingMachine.swift#L60-L92) extends the integer deadline and replaces `trailingValue`, whose type is `Value?`. This excerpt omits the new-burst branch but retains the worker decision:

```swift
@inlinable
mutating func send(_ value: Value, now: UInt64) -> Bool {
    let newDeadline = _deadline(after: now, adding: interval)

    if let currentDeadline = burstDeadline, now < currentDeadline {
        burstDeadline = max(currentDeadline, newDeadline)

        if edges.contains(.trailing) {
            trailingValue = value
        }
    } else {
        // Start a new burst (omitted).
    }

    if isWorkerActive {
        return false
    }

    isWorkerActive = true
    return true
}
```

With `Value == Int` and these bodies available, the optimizer can follow the optional replacement through the locked closure. The `max` also preserves the later deadline if concurrent callers read their clocks before acquiring the lock and reach the critical section in a different order.

An inlinable body must be able to refer to the declarations it uses from client code. The package marks its internal storage, core, and helpers `@usableFromInline` for that purpose. The attribute exposes a declaration through the binary interface without making it ordinary public Swift API or exposing its function body for optimization. The [Swift library-evolution documentation](https://github.com/swiftlang/swift/blob/c06a182b36451e19ddf17189b872151b7b163dca/docs/LibraryEvolution.rst#L894-L903) makes that distinction explicit.

Worker creation uses this narrower visibility. The [actual method](https://github.com/ivan-magda/swift-debounce/blob/990cf04587cf922748c13876d2843071c22873fa/Sources/Debounce/Internal/Pacer.swift#L50-L58) is `@usableFromInline`, without `@inlinable`, so the repeated path can remain visible while this branch stays a call:

```swift
@usableFromInline
func startWorker(_ state: inout _PacerState<Machine>) {
    let previousWorker = state.worker
    let generation = state.generation

    state.worker = Task {
        await previousWorker?.value
        await self.run(generation: generation)
    }
}
```

Most sends in a long burst never take that branch. Waiting for `previousWorker` also preserves the serial-action policy across a cancelled predecessor that has not returned. The package has a [runtime check of that case](https://github.com/ivan-magda/swift-debounce/blob/990cf04587cf922748c13876d2843071c22873fa/Tests/DebounceE2ETests/DebouncerE2ETests.swift#L147-L164), using an action that ignores cancellation until released.

Publishing these bodies carries a maintenance cost. In a distributed binary library, existing clients may retain an older inlined implementation after the library changes, and `@usableFromInline` declarations form part of its ABI commitments. A source dependency rebuilt with the application has a different deployment arrangement; it still exposes implementation to the optimizer. Swift's [discussion of inlinable functions](https://www.swift.org/blog/library-evolution/#inlinable-functions) explains the binary-compatibility obligations.

The final benchmark enables CMO for its [`References` target](https://github.com/ivan-magda/swift-debounce/blob/990cf04587cf922748c13876d2843071c22873fa/Benchmarks/Package.swift#L13-L20) too. That gives the references an opportunity to specialize across their module boundary. This current setting differs from the historical `CMO` environment switch used on the old `Debounce` target.

## Separating the lock from its state changed the result

After reducing the repeated send cost, I compared ways to store the lock and protected state. Keeping them in one allocation seemed useful: a `ManagedBuffer` can hold the state in its header and the lock in its element area. A separately allocated lock adds an allocation and another pointer to follow.

The earlier storage experiment produced a different result under contention. Separating the lock hurt single-thread performance but helped with competing senders. I tried keeping the single allocation while increasing the distance between the state and lock.

This experiment uses a simplified `BoxedDebounce` with interchangeable storage wrappers. It compares storage for the same algorithm, rather than measuring another stage of the complete public `Debouncer`.

### Keeping one allocation while moving the lock

The [adjacent prototype](https://github.com/ivan-magda/swift-debounce/blob/990cf04587cf922748c13876d2843071c22873fa/Benchmarks/Sources/References/StorageVariants.swift#L40-L46) initializes its lock at the start of the element area. The state remains the buffer's header:

```swift
@inlinable
public init(_ initial: sending Wrapped) {
    let buffer = Storage.create(minimumCapacity: 1) { newBuffer in
        newBuffer.withUnsafeMutablePointerToElements { lockElements in
            let lock = lockElements
            lock.initialize(to: os_unfair_lock_s())
        }

        return initial
    }

    storage = unsafeDowncast(buffer, to: Storage.self)
}
```

The [padded prototype](https://github.com/ivan-magda/swift-debounce/blob/990cf04587cf922748c13876d2843071c22873fa/Benchmarks/Sources/References/StorageVariants.swift#L58-L70) computes `lockIndex` as `128 / MemoryLayout<os_unfair_lock_s>.stride`. Its initializer reserves enough elements to reach that index and initializes the lock there:

```swift
@inlinable
public init(_ initial: sending Wrapped) {
    let buffer = Storage.create(minimumCapacity: Self.lockIndex + 1) { newBuffer in
        newBuffer.withUnsafeMutablePointerToElements { lockElements in
            let lock = lockElements + Self.lockIndex
            lock.initialize(to: os_unfair_lock_s())
        }

        return initial
    }

    storage = unsafeDowncast(buffer, to: Storage.self)
}
```

The offset begins at the element-area base, not at the first byte of the state or allocation. The corresponding [`withLock` method](https://github.com/ivan-magda/swift-debounce/blob/990cf04587cf922748c13876d2843071c22873fa/Benchmarks/Sources/References/StorageVariants.swift#L71-L79) uses the same index, while passing the unchanged state pointer into the protected operation:

```swift
@inlinable
public func withLock<Result>(_ body: (inout Wrapped) -> Result) -> Result {
    storage.withUnsafeMutablePointers { statePointer, lockElements in
        let lock = lockElements + Self.lockIndex

        os_unfair_lock_lock(lock)
        defer {
            os_unfair_lock_unlock(lock)
        }

        return body(&statePointer.pointee)
    }
}
```

We retain one allocation and the same lock primitive, but change where callers access the lock. The generic state's size and the allocation's alignment still determine the surrounding addresses.

<figure class="research-figure">
  <a class="figure-light" href="/images/swift-debounce-runtime-investigation/09-storage-layout.svg"><img src="/images/swift-debounce-runtime-investigation/09-storage-layout.svg" alt="Adjacent ManagedBuffer storage places the state and lock near each other; padded storage reserves 128 bytes in the element area before the lock, increasing measured heap use from 160 to 288 bytes." width="720" height="496" loading="lazy" decoding="async" /></a>
  <a class="figure-dark" href="/images/swift-debounce-runtime-investigation/09-storage-layout-dark.svg"><img src="/images/swift-debounce-runtime-investigation/09-storage-layout-dark.svg" alt="Adjacent ManagedBuffer storage places the state and lock near each other; padded storage reserves 128 bytes in the element area before the lock, increasing measured heap use from 160 to 288 bytes." width="720" height="496" loading="lazy" decoding="async" /></a>
</figure>

_Storage geometry from the [adjacent and padded prototypes](https://github.com/ivan-magda/swift-debounce/blob/990cf04587cf922748c13876d2843071c22873fa/Benchmarks/Sources/References/StorageVariants.swift#L33-L79). The drawing shows pointer placement, not physical cache-line boundaries or an exact offset from the start of `State`._

The saved storage suite compares five wrappers over nine interleaved rounds after warm-up. Its single-thread samples send two million values; contended samples use eight threads with 100,000 values each. Both use a 20 ms quiet period:

<figure class="research-figure">
  <a class="figure-light" href="/images/swift-debounce-runtime-investigation/11-storage-variants.svg">
    <picture>
      <source media="(max-width: 640px)" srcset="/images/swift-debounce-runtime-investigation/11-storage-variants-mobile.svg" width="360" height="1080" />
      <img src="/images/swift-debounce-runtime-investigation/11-storage-variants.svg" alt="Single-thread and eight-thread send costs for five storage wrappers, showing medians and observed minimum-to-maximum ranges over nine rounds. Padded ManagedBuffer stays near 13 ns with one sender and has the lowest median with eight senders, 54.2 ns." width="720" height="1100" loading="lazy" decoding="async" />
    </picture>
  </a>
  <a class="figure-dark" href="/images/swift-debounce-runtime-investigation/11-storage-variants-dark.svg">
    <picture>
      <source media="(max-width: 640px)" srcset="/images/swift-debounce-runtime-investigation/11-storage-variants-mobile-dark.svg" width="360" height="1080" />
      <img src="/images/swift-debounce-runtime-investigation/11-storage-variants-dark.svg" alt="Single-thread and eight-thread send costs for five storage wrappers, showing medians and observed minimum-to-maximum ranges over nine rounds. Padded ManagedBuffer stays near 13 ns with one sender and has the lowest median with eight senders, 54.2 ns." width="720" height="1100" loading="lazy" decoding="async" />
    </picture>
  </a>
</figure>

<details class="research-data">
  <summary>View data<span class="sr-only">: Storage wrapper comparison</span></summary>

Send columns show median [minimum–maximum] across nine rounds.

<div data-table-scroll style="overflow-x: auto" tabindex="0" role="region" aria-label="Storage wrapper comparison">

| Storage for the simplified debouncer | Send, one thread (ns) | Send, eight threads (ns) | Raw lock, eight threads | Heap per instance |
| ------------------------------------ | --------------------: | -----------------------: | ----------------------: | ----------------: |
| `Synchronization.Mutex`              |      13.2 [13.1–13.3] |         86.8 [77.5–94.3] |                 27.2 ns |             128 B |
| `ManagedBuffer`, adjacent lock       |      13.1 [13.0–13.2] |         79.7 [73.7–97.7] |                 24.9 ns |             160 B |
| `ManagedBuffer`, padded lock         |      13.2 [13.2–13.3] |         54.2 [51.9–62.6] |                 37.1 ns |             288 B |
| `OSAllocatedUnfairLock`              |      13.1 [13.1–13.2] |        84.6 [71.3–118.8] |                 23.6 ns |             160 B |
| Separate lock allocation             |      17.9 [17.8–18.0] |         65.7 [62.7–67.5] |                 38.4 ns |             144 B |

</div>

</details>

_Medians and observed min–max across nine interleaved rounds from the [storage results](https://github.com/ivan-magda/swift-debounce/blob/990cf04587cf922748c13876d2843071c22873fa/Benchmarks/results/2026-10-13/storage.md), in the recorded M1 Max release environment. Eight-thread costs divide aggregate wall time by all operations. The raw-lock workload uses 250,000 counter increments per thread._

The [storage harness](https://github.com/ivan-magda/swift-debounce/blob/990cf04587cf922748c13876d2843071c22873fa/Benchmarks/Sources/Storage/main.swift#L39-L87) measures heap cost using malloc's in-use delta across 100,000 retained instances, after reserving their holding array.

The separate allocation preserved the anomaly: 17.9 ns versus 13.1 ns with one sender, but 65.7 ns versus 79.7 ns with eight. Padding kept single-thread cost near 13 ns and reduced the useful contended operation to 54.2 ns, about 32% below the adjacent layout.

Across those rounds, adjacent storage ranged from 73.7 to 97.7 ns per contended send; padded storage ranged from 51.9 to 62.6 ns. Aggregate CPU cost fell from 602.8 to 405.3 ns per send too. The improvement did not depend on choosing one unusually good round.

### The raw lock and the protected operation disagreed

The raw-lock result moved the other way: **24.9 ns** for adjacent storage became **37.1 ns** with padding. Selecting the wrapper by that benchmark alone would have rejected the layout that helped the debounce state update.

<figure class="research-figure">
  <a class="figure-light" href="/images/swift-debounce-runtime-investigation/10-storage-tradeoff.svg"><img src="/images/swift-debounce-runtime-investigation/10-storage-tradeoff.svg" alt="Padding worsens raw contended lock cost from 24.9 to 37.1 ns, improves useful send cost from 79.7 to 54.2 ns, and adds 128 measured heap bytes per instance." width="720" height="840" loading="lazy" decoding="async" /></a>
  <a class="figure-dark" href="/images/swift-debounce-runtime-investigation/10-storage-tradeoff-dark.svg"><img src="/images/swift-debounce-runtime-investigation/10-storage-tradeoff-dark.svg" alt="Padding worsens raw contended lock cost from 24.9 to 37.1 ns, improves useful send cost from 79.7 to 54.2 ns, and adds 128 measured heap bytes per instance." width="720" height="840" loading="lazy" decoding="async" /></a>
</figure>

_Separate workloads and units from the same [nine-round storage experiment](https://github.com/ivan-magda/swift-debounce/blob/990cf04587cf922748c13876d2843071c22873fa/Benchmarks/results/2026-10-13/storage.md). Raw lock and useful send are eight-thread aggregate wall costs; heap use rises from 160 to 288 bytes._

Cache coherence provides a possible explanation. Cores coordinate access at cache-line granularity, which groups several nearby bytes together. Suppose one core owns the lock and writes the protected state while another core accesses the lock word. If both locations occupy the same line, obtaining or changing ownership for the lock can also affect the line containing the owner's state. The hardware cannot treat the independent fields as independent coherence units. Separating the locations can reduce that interference, while genuine contention for the lock and transfer of protected state between owners remain.

This lock-and-data pattern appears in the [Linux kernel's false-sharing documentation](https://docs.kernel.org/kernel-hacking/false-sharing.html). It gives us a model for the result without establishing the behavior of `os_unfair_lock` in this run. The separate-allocation and padded-allocation measurements support the hypothesis; the investigation contains no hardware-counter evidence isolating the coherence traffic.

The two workloads also touch different amounts of state. A raw-lock operation increments one integer. The debouncer changes a payload, deadline, and worker bookkeeping while holding the lock. Accessing another region of memory need not help the smaller operation. Measuring the protected algorithm was necessary to make the storage choice.

The final package retains the padded single-allocation approach, with a [rounded-up index](https://github.com/ivan-magda/swift-debounce/blob/990cf04587cf922748c13876d2843071c22873fa/Sources/Debounce/Internal/LockedStorage.swift#L25-L41) for the platform lock's stride:

```swift
@inlinable
@inline(__always)
static var lockIndex: Int {
    let paddingBytes = 128
    let lockStride = MemoryLayout<_PlatformLock>.stride

    return (paddingBytes + lockStride - 1) / lockStride
}
```

Its allocation reserves `lockIndex + 1` elements and initializes the lock at that offset. The 128-byte distance is a choice in this implementation, not a universal cache-line size for Apple processors; Apple's [architecture guidance](https://developer.apple.com/documentation/apple-silicon/addressing-architectural-differences-in-your-macos-code) advises querying such platform properties.

Padding added 128 bytes per measured instance, with almost no single-thread send improvement. An application holding many mostly idle debouncers might value that space differently from one with several threads feeding a shared instance.

## Send cost and action latency were different results

The completed package combines worker reuse, integer deadlines, a path visible to client optimization, and the chosen storage layout. Returning to the original burst workload gives the full comparison:

<figure class="research-figure">
  <a class="figure-light" href="/images/swift-debounce-runtime-investigation/02-send-baseline.svg">
    <picture>
      <source media="(max-width: 640px)" srcset="/images/swift-debounce-runtime-investigation/02-send-baseline-mobile.svg" width="360" height="680" />
      <img src="/images/swift-debounce-runtime-investigation/02-send-baseline.svg" alt="For 100,000 inputs, send costs are 798, 216, and 16 ns for task per value, the long-lived task, and swift-debounce. Total process CPU is 280.81, 21.91, and 1.72 ms, respectively." width="720" height="650" loading="lazy" decoding="async" />
    </picture>
  </a>
  <a class="figure-dark" href="/images/swift-debounce-runtime-investigation/02-send-baseline-dark.svg">
    <picture>
      <source media="(max-width: 640px)" srcset="/images/swift-debounce-runtime-investigation/02-send-baseline-mobile-dark.svg" width="360" height="680" />
      <img src="/images/swift-debounce-runtime-investigation/02-send-baseline-dark.svg" alt="For 100,000 inputs, send costs are 798, 216, and 16 ns for task per value, the long-lived task, and swift-debounce. Total process CPU is 280.81, 21.91, and 1.72 ms, respectively." width="720" height="650" loading="lazy" decoding="async" />
    </picture>
  </a>
</figure>

<details class="research-data">
  <summary>View data<span class="sr-only">: Final implementation comparison</span></summary>

<div data-table-scroll style="overflow-x: auto" tabindex="0" role="region" aria-label="Final implementation comparison">

| Implementation  | Amortized send cost | Send-loop wall time | Total process CPU |
| --------------- | ------------------: | ------------------: | ----------------: |
| Task per value  |              798 ns |            79.82 ms |         280.81 ms |
| Long-lived task |              216 ns |            21.61 ms |          21.91 ms |
| Package         |               16 ns |             1.57 ms |           1.72 ms |

</div>

</details>

_100,000 integer values, one sender, 10 ms quiet period; median of 15 rounds, M1 Max, macOS 26.7.1, Swift 6.4, release. [Scenario results](https://github.com/ivan-magda/swift-debounce/blob/990cf04587cf922748c13876d2843071c22873fa/Benchmarks/results/2026-10-13/scenarios.md). The approximately 50× ratio is 798 ÷ 16 in this workload. CPU sums work across threads over a longer window, including output and settling._

The result belongs to the whole implementation. The separate lock, clock, compiler, and layout experiments do not divide that gain into independent contributions. The references include atomic task and wakeup counters; the package has no matching instrumentation. Its worker policy follows from the source rather than a measured task-count row.

The [harness snapshots](https://github.com/ivan-magda/swift-debounce/blob/990cf04587cf922748c13876d2843071c22873fa/Benchmarks/Sources/Scenarios/main.swift#L147-L161) show those windows. This excerpt begins after constructing the debouncer and ends before checking the result and returning the metrics:

```swift
let beforeSending = ProcSnapshot.now()

for value in 0..<sendCount {
    debouncer.emit(value: value)
}

let afterSending = ProcSnapshot.now()

let deliveredValue = await sink.waitFirst()
let afterDelivery = ProcSnapshot.now()

await settle()
let afterSettling = ProcSnapshot.now()

withExtendedLifetime(debouncer) {}
```

Send cost uses `afterSending.wall - beforeSending.wall`, divided by `sendCount`. Total CPU uses `afterSettling.cpu - beforeSending.cpu`, after receiving the output and allowing a 30 ms settling period for cancelled tasks to drain. The harness also checks that the final input was the single delivered value.

`withExtendedLifetime` came from a release-build lifetime problem during the investigation. The optimizer can release an object after its last use, before the closing brace of its lexical scope. Keeping the debouncer alive through observation prevents its lifetime from ending while the harness waits for the async result.

Burst size changes the amortized input cost. With 1,000 values, the package measured **41 ns per send**, compared with 16 ns for 100,000. Worker-start and other work inside the input loop spread across fewer calls. Callback completion and settling remain outside this measurement window.

### Measuring lateness from the last value

The scenario harness's first-input-to-output interval includes time spent feeding the burst. A debouncer's quiet period begins with its latest input, so callback lateness needs a different reference point.

After seeing larger delays in the combined scenario harness, I used a focused harness with a 50 ms quiet period and 30 interleaved bursts per input pattern. It records a timestamp in the callback and compares that with the time immediately after the last send. This [measurement body](https://github.com/ivan-magda/swift-debounce/blob/990cf04587cf922748c13876d2843071c22873fa/Benchmarks/Sources/Latency/main.swift#L27-L37) omits the surrounding function declaration:

```swift
let fireTime = FireTime()
let debouncer = make(.milliseconds(50), fireTime.record)
var lastSendTime: UInt64 = 0

for value in 0..<sends {
    if let cadenceMs {
        let pauseNanoseconds = cadenceMs * 1_000_000
        try? await Task.sleep(nanoseconds: pauseNanoseconds)
    }

    debouncer.emit(value: value)
    lastSendTime = now()
}

while fireTime.value.load(ordering: .relaxed) == 0 {
    try? await Task.sleep(nanoseconds: 1_000_000)
}

withExtendedLifetime(debouncer) {}

let callbackTime = fireTime.value.load(ordering: .relaxed)
let elapsedMilliseconds = Double(callbackTime - lastSendTime) / 1_000_000
return elapsedMilliseconds - 50
```

The return value is **callback overshoot in milliseconds** beyond the requested 50 ms. The polling loop waits until the recorded timestamp is available; its wakeup does not define the callback time. Rotating implementation order between rounds reduces dependence on which implementation runs first.

<figure class="research-figure">
  <a class="figure-light" href="/images/swift-debounce-runtime-investigation/12-cost-versus-latency.svg">
    <picture>
      <source media="(max-width: 640px)" srcset="/images/swift-debounce-runtime-investigation/12-cost-versus-latency-mobile.svg" width="360" height="1070" />
      <img src="/images/swift-debounce-runtime-investigation/12-cost-versus-latency.svg" alt="Median and p95 callback overshoot for three input patterns, all on a 0–4 ms scale. The package’s medians are 1.38 ms for one value, 1.19 ms for 20 at once, and 1.08 ms for 60 values spaced 5 ms apart. The ranking changes with the input pattern." width="720" height="1100" loading="lazy" decoding="async" />
    </picture>
  </a>
  <a class="figure-dark" href="/images/swift-debounce-runtime-investigation/12-cost-versus-latency-dark.svg">
    <picture>
      <source media="(max-width: 640px)" srcset="/images/swift-debounce-runtime-investigation/12-cost-versus-latency-mobile-dark.svg" width="360" height="1070" />
      <img src="/images/swift-debounce-runtime-investigation/12-cost-versus-latency-dark.svg" alt="Median and p95 callback overshoot for three input patterns, all on a 0–4 ms scale. The package’s medians are 1.38 ms for one value, 1.19 ms for 20 at once, and 1.08 ms for 60 values spaced 5 ms apart. The ranking changes with the input pattern." width="720" height="1100" loading="lazy" decoding="async" />
    </picture>
  </a>
</figure>

<details class="research-data">
  <summary>View data<span class="sr-only">: Callback overshoot comparison</span></summary>

<div data-table-scroll style="overflow-x: auto" tabindex="0" role="region" aria-label="Callback overshoot comparison">

| Input pattern             | Implementation       | Median (ms) | p95 (ms) |
| ------------------------- | -------------------- | ----------: | -------: |
| One value                 | Task per value       |        1.01 |     2.07 |
| One value                 | Long-lived reference |        1.04 |     2.16 |
| One value                 | Package              |        1.38 |     2.60 |
| 20 values at once         | Task per value       |        0.96 |     2.07 |
| 20 values at once         | Long-lived reference |        1.18 |     3.32 |
| 20 values at once         | Package              |        1.19 |     1.70 |
| 60 values, one every 5 ms | Task per value       |        1.02 |     2.03 |
| 60 values, one every 5 ms | Long-lived reference |        0.77 |     1.91 |
| 60 values, one every 5 ms | Package              |        1.08 |     2.38 |

</div>

</details>

_Median and p95 overshoot beyond the 50 ms quiet period from the [focused latency results](https://github.com/ivan-magda/swift-debounce/blob/990cf04587cf922748c13876d2843071c22873fa/Benchmarks/results/2026-10-13/latency.md), 30 interleaved bursts per pattern in the same M1 Max release environment. The 5 ms cadence is a synthetic 200 Hz stream, rather than typical human typing._

For one value, the package's median overshoot was higher in this run. For 20 values, it was close to the long-lived reference. The p95 results also changed with the pattern: for 20 values they were 2.07 ms, 3.32 ms, and 1.70 ms, respectively. These observations do not establish one callback-latency ranking across workloads.

Reducing work inside `send` leaves the requested quiet period unchanged. The worker still needs to resume after sleeping and reach the action through the relevant executor. The focused harness measures that combined outcome without isolating the timer from scheduling and executor delay. It shows lower input-processing cost alongside millisecond callback overshoot, with no corresponding fiftyfold improvement in delivery time.

The resource benefit is clearest in dense bursts. In the scenario suite's paced synthetic stream, 200 events separated by 5 ms consumed 31.10 ms of total CPU with task per value, 21.65 ms with the long-lived reference, and 21.22 ms with the package. A separate no-debouncer run measured 19.94 ms of CPU; the implementation totals above are not baseline-subtracted. This [separate scenario](https://github.com/ivan-magda/swift-debounce/blob/990cf04587cf922748c13876d2843071c22873fa/Benchmarks/results/2026-10-13/scenarios.md) puts the smaller difference between the worker-based designs under paced input in context.

## How the package handles long-running actions

An action can still be running when the next burst arrives. The implementations handle that case differently.

The reference's [`sleepIsOver()` transition](https://github.com/ivan-magda/swift-debounce/blob/990cf04587cf922748c13876d2843071c22873fa/Benchmarks/Sources/References/ReferenceDebouncers.swift#L113-L123) changes the state to `.idle` before the worker awaits `output(value)`. A later send can start another worker while that action remains suspended. If the next quiet period expires first, the actions can overlap.

The package uses a serial-action policy. Its worker stays active while awaiting the action; new input updates pending state. The worker asks for its next step after the action returns. A value whose quiet period has already expired may therefore wait for the previous action too.

<figure class="research-figure">
  <a class="figure-light" href="/images/swift-debounce-runtime-investigation/03-action-serialization.svg"><img src="/images/swift-debounce-runtime-investigation/03-action-serialization.svg" alt="The reference can start a second action while the first is suspended; the package waits for the running action to return before delivering another due value." width="720" height="592" loading="lazy" decoding="async" /></a>
  <a class="figure-dark" href="/images/swift-debounce-runtime-investigation/03-action-serialization-dark.svg"><img src="/images/swift-debounce-runtime-investigation/03-action-serialization-dark.svg" alt="The reference can start a second action while the first is suspended; the package waits for the running action to return before delivering another due value." width="720" height="592" loading="lazy" decoding="async" /></a>
</figure>

_Action ordering from the [reference's idle transition](https://github.com/ivan-magda/swift-debounce/blob/990cf04587cf922748c13876d2843071c22873fa/Benchmarks/Sources/References/ReferenceDebouncers.swift#L113-L123) and the package's [worker loop](https://github.com/ivan-magda/swift-debounce/blob/990cf04587cf922748c13876d2843071c22873fa/Sources/Debounce/Internal/Pacer.swift#L60-L105). Action lengths illustrate the two contracts._

We can follow the package's transitions without a real timer. In this [virtual-time example](https://github.com/ivan-magda/swift-debounce/blob/990cf04587cf922748c13876d2843071c22873fa/Tests/DebounceTests/DebounceMachineTests.swift#L27-L38), `machine()` creates a trailing debouncer with an interval of 100 abstract ticks. Value `a` arrives at 0 and becomes due at 100; while its action runs, `b` and `c` arrive:

```swift
@Test
func valueSentWhileActionRunsWaitsForTheQuietPeriod() {
    var stateMachine = machine()

    _ = stateMachine.send("a", now: 0)
    #expect(stateMachine.next(now: 100) == .run("a"))

    // New values arrive while the action for "a" is running.
    #expect(stateMachine.send("b", now: 120) == false)
    #expect(stateMachine.send("c", now: 130) == false)

    // The action returns, but "c" still needs its full quiet period.
    #expect(stateMachine.next(now: 150) == .sleep(until: 230))
    #expect(stateMachine.next(now: 230) == .run("c"))
    #expect(stateMachine.next(now: 240) == .exit)
}
```

Both sends return `false` because a worker already exists. At tick 150, action `a` has returned, but the last input arrived at 130, so the worker must wait another 80 ticks before delivering `c`. The driver obeys a separate rule: it does not call `next` during an action. The machine chooses the next operation; the worker enforces that ordering.

<figure class="research-figure">
  <a class="figure-light" href="/images/swift-debounce-runtime-investigation/13-state-machine.svg"><img src="/images/swift-debounce-runtime-investigation/13-state-machine.svg" alt="The package&#x27;s trailing debouncer has four conceptual states: idle, waiting, running an action, and running with pending input." width="720" height="856" loading="lazy" decoding="async" /></a>
  <a class="figure-dark" href="/images/swift-debounce-runtime-investigation/13-state-machine-dark.svg"><img src="/images/swift-debounce-runtime-investigation/13-state-machine-dark.svg" alt="The package&#x27;s trailing debouncer has four conceptual states: idle, waiting, running an action, and running with pending input." width="720" height="856" loading="lazy" decoding="async" /></a>
</figure>

_Trailing behavior from the package's [state machine](https://github.com/ivan-magda/swift-debounce/blob/990cf04587cf922748c13876d2843071c22873fa/Sources/Debounce/Internal/PacingMachine.swift#L41-L123) and [worker](https://github.com/ivan-magda/swift-debounce/blob/990cf04587cf922748c13876d2843071c22873fa/Sources/Debounce/Internal/Pacer.swift). Cancellation is omitted from the diagram; these states summarize behavior rather than the stored representation._

## What the measurements changed

The lock replacement saved about as much as its isolated cost suggested. The remaining method required two different runtime investigations: one into a resilient deadline representation, another into the optimizer's access to generic state. The layout experiment then favored storage that lost the raw-lock comparison. In each case, measuring the complete operation changed how I interpreted a smaller benchmark.

That work became [swift-debounce](https://github.com/ivan-magda/swift-debounce), with a shared engine for debounce and throttle and [SwiftUI integration](https://github.com/ivan-magda/swift-debounce/blob/990cf04587cf922748c13876d2843071c22873fa/Sources/Debounce/Debounce.docc/UsingWithSwiftUI.md). The [benchmark guide](https://github.com/ivan-magda/swift-debounce/blob/990cf04587cf922748c13876d2843071c22873fa/Benchmarks/README.md) contains reproduction commands and other workloads; the [getting-started guide](https://github.com/ivan-magda/swift-debounce/blob/990cf04587cf922748c13876d2843071c22873fa/Sources/Debounce/Debounce.docc/GettingStarted.md) covers usage. For a high-volume event source, less work accepting values and less CPU spent coalescing them are useful gains. Callback timing remains something to measure for the workload that will use the package.

Thanks for reading!
