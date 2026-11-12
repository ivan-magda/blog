---
title: "Swift synchronization benchmarks: Mutex, locks, queues, atomics, and actors on real iPhones"
ogTitle: "Swift synchronization benchmarks on real iPhones"
author: "Ivan Magda"
pubDatetime: 2026-11-12T00:20:00Z
slug: "swift-synchronization-benchmarks"
featured: false
draft: false
tags:
  - swift
  - performance
  - concurrency
description: "Eight experiments on two physical iPhones that compare Mutex, OSAllocatedUnfairLock, NSLock, dispatch queues, Atomic, and actors on tasks taken from real apps."
---

Over my years as an iOS developer I've kept running into advice about which synchronization mechanism is the fast one. If you need performance, use `os_unfair_lock`. If reads far outnumber writes, look at a read-write lock or a concurrent queue with barrier writes. And whenever Swift Concurrency comes up, someone says that actors are slow and lose to plain locks.

I wanted to see how well that advice holds up in practice, so I compared synchronization mechanisms on tasks that resemble what real apps do. I also wanted to find out whether one mechanism can be the default choice for most of them.

I started from two articles, by [Vadim Bulavin](https://www.vadimbulavin.com/benchmarking-locking-apis/) and [Marin Todorov](https://trycombine.com/posts/performance-actor-queue-lock-benchmark/), that compare synchronization mechanisms on simple operations. New APIs have appeared since then, including `Synchronization.Mutex` and `Atomic`. I wanted to repeat the baseline comparisons with today's tools and then check how much the choice of mechanism affects the speed of everyday app tasks.

To choose the tasks, I looked at how popular open source libraries and apps synchronize access to state: SDWebImage, Alamofire, Apollo iOS, Nuke, Firebase, and Pocket Casts. One example is how image-loading libraries protect their cache and keep track of active requests. From those examples I built a [benchmark](https://github.com/ivan-magda/swift-synchronization-benchmarks) that runs the same work with different synchronization mechanisms and compares the results.

I ran every measurement in Release builds on two physical devices: an iPhone 11 Pro Max and an iPhone 15 Pro Max.

For each experiment I'll describe the task, what exactly I measured, and what the results show. At the end I'll pull the conclusions together: when `Mutex` is enough, where `Atomic` makes sense, and what to keep in mind when working with actors.

Fair warning: this article is long. It's a full study, and I couldn't shorten it without losing something. If you're short on time, you don't have to read it from start to finish: pick the experiment you care about, or jump straight to the [conclusion](#conclusion). Each section stands on its own.

**In this article**

- [How I measured](#how-i-measured)
- [Baseline: read, write, counter](#baseline-read-write-counter)
- [Synchronizing access to a dictionary](#synchronizing-access-to-a-dictionary)
- [What it costs to read a feature flag](#what-it-costs-to-read-a-feature-flag)
- [Many reads, few writes: do you need a read-write lock?](#many-reads-few-writes-do-you-need-a-read-write-lock)
- [Are actors really slow?](#are-actors-really-slow)
- [An image cache during scrolling](#an-image-cache-during-scrolling)
- [Priority inversion: the main thread waits for a background thread](#priority-inversion-the-main-thread-waits-for-a-background-thread)
- [Creation cost and memory footprint](#creation-cost-and-memory-footprint)
- [Conclusion](#conclusion)

## How I measured

iOS versions on the devices:

| Device            | iOS version |
| ----------------- | ----------- |
| iPhone 15 Pro Max | 26.6.2      |
| iPhone 11 Pro Max | 26.6        |

I built the benchmark with Xcode 27.1 and Swift 6.4.0 in the Release configuration. I'll show the main results for the iPhone 15 Pro Max and call out where the iPhone 11 Pro Max differs. The charts are interactive: each one switches between the two phones, and pointing at a row shows its ratio to `Mutex` and the spread across launches.

In each experiment I compared implementations of one task that differ only in the synchronization mechanism. In the counter test, for example, one operation increments a value by one. The measured time includes both the access to the protected state and the work done on it.

I launched each test several times. Within one launch the app repeated the measured operation many times, in some tests millions of times. That gave me the average time of short operations, and the repeated launches showed how stable the result was. Across the two phones, that added up to 1,366 launches.

### Time per operation

For short operations I timed a whole batch and divided by the number of operations. Here is a simplified example with a counter:

```swift
import Synchronization

let counter = Mutex<Int>(0)
let iterations = 1_000_000
let clock = ContinuousClock()

let elapsed = clock.measure {
    for _ in 0..<iterations {
        counter.withLock { value in
            value += 1
        }
    }
}

let timePerOperation = elapsed / iterations
```

The loop increments the counter a million times. Each increment acquires the lock, changes the value, and releases the lock. Dividing the loop time by a million gives the average time of one operation: if the loop took 2 ms, that's 2 ns per operation.

Each app launch measured several such batches. I took the median across batches, then the median across launches. That value is what the tables and charts show.

Say five batches gave 1.9, 2.0, 2.1, 2.2, and 5.0 ns per operation. The values are already sorted, so the median is the middle one, 2.1 ns. That becomes the result of the launch.

### Operations per second and the latency of individual calls

With several threads, I also measured how many operations they completed per second in total. I added up the operations of all threads and divided by the time from the first thread's start to the last thread's finish. Higher is better. Time per operation shows how long one operation takes on one thread; operations per second shows how much work all the threads get done together.

Suppose four threads each complete a million operations, and half a second passes between the first start and the last finish. That's 4 million operations in 0.5 seconds, or 8 million operations per second.

To assess latency, I timed individual calls and summarized them with two numbers:

- **p50, the median:** half of the measured calls finished in this time or less.
- **p99:** about 99% of the measured calls finished in this time or less. With a p99 of 20 µs, roughly 99 calls out of a hundred fit within 20 µs and one took longer.

I computed both for each launch separately and took the median across launches for the final comparison.

The source code and the [measurement method](https://github.com/ivan-magda/swift-synchronization-benchmarks/blob/main/docs/results.md) are in the repository. The [raw results](https://github.com/ivan-magda/swift-synchronization-benchmarks/releases/tag/benchmark-results-2026-11-07) are published separately.

## Baseline: read, write, counter

I'll start with the question Vadim Bulavin and Marin Todorov asked: how long does the simplest operation on shared state take under each synchronization mechanism? The shared state is deliberately trivial: a single integer. There are three operations, each measured separately:

- **read:** a thread reads a value that nobody changes;
- **write:** a thread replaces the value with a new number;
- **counter:** a thread increments the value by one.

A single thread performs all the operations (a single `Task` in the actor case). I'll call this mode "uncontended" from here on. The synchronization is still there: every operation acquires and releases the lock. No other thread holds it at that moment, so there's nothing to wait for.

Apps do this all the time: a background thread occasionally updates a download state, and the main thread occasionally reads it.

### What I measured

The `Mutex` increment appeared in the example above. For the other mechanisms, only the protection changes. Here is the same operation, simplified, for three of them. With `Atomic`, the increment is a single atomic operation:

```swift
let counter = Atomic<Int>(0)

counter.wrappingAdd(1, ordering: .acquiringAndReleasing)
```

With a serial queue, every access goes through `sync`:

```swift
let queue = DispatchQueue(label: "counter")
var value = 0

queue.sync {
    value += 1
}
```

With an actor, every access is a separate `await` call from a background task:

```swift
actor Counter {
    private var value = 0

    func increment() -> Int {
        value += 1
        return value
    }
}

let counter = Counter()

let newValue = await counter.increment()
```

The actor method returns the new value, and the loop uses it. Otherwise the compiler optimizes the loop, and the result no longer reflects an ordinary `await` call from another task.

The comparison covers 20 variants. The full list and the code for each are in the [repository](https://github.com/ivan-magda/swift-synchronization-benchmarks/tree/main/Experiments/BaseComparison).

### Uncontended results

Locks and `Atomic` come first. The chart shows the time of one counter increment; shorter bars are faster.

The actor and the queues don't fit on this scale: they take tens of times longer. The switch above the chart adds them to the same axis.

<bench-chart chart="base">
<p>Time of one counter increment for the locks and Atomic. Mutex, OSAllocatedUnfairLock, os_unfair_lock, and Atomic take 1.9 ns each, DispatchSemaphore 3.7 ns, pthread_mutex 4.6 ns, pthread_rwlock 6.0 ns, NSLock 6.4 ns, OSAllocatedUnfairLock with adaptiveSpin 8.5 ns, objc_sync 10.9 ns, NSRecursiveLock 12.7 ns. With the actor and the queues added: actor 62.8 ns, serial DispatchQueue 88.2 ns, concurrent queue with an async barrier 110.4 ns, concurrent queue with a sync barrier 209.6 ns.</p>
</bench-chart>

<details class="research-data">
  <summary>View data<span class="sr-only">: uncontended read, write, and counter</span></summary>

<div data-table-scroll style="overflow-x: auto" tabindex="0" role="region" aria-label="uncontended read, write, and counter">

| Mechanism                                    | Read, ns | Write, ns | Counter, ns | Counter relative to `Mutex` |
| -------------------------------------------- | -------: | --------: | ----------: | --------------------------: |
| `Mutex`                                      |     1.85 |      1.85 |        1.86 |                        1.0× |
| `OSAllocatedUnfairLock`                      |     1.86 |      1.86 |        1.86 |                        1.0× |
| `os_unfair_lock`                             |     1.86 |      1.86 |        1.85 |                        1.0× |
| `pthread_mutex`                              |     4.59 |      4.60 |        4.62 |                        2.5× |
| `NSLock`                                     |     6.36 |      6.36 |        6.36 |                        3.4× |
| `OSAllocatedUnfairLock` with `.adaptiveSpin` |     8.48 |      8.22 |        8.49 |                        4.6× |
| `Atomic`                                     |     0.27 |      0.27 |        1.88 |                        1.0× |
| actor                                        |    62.64 |     62.03 |       62.77 |                         34× |
| Serial `DispatchQueue`                       |   199.42 |    107.47 |       88.23 |                         48× |

</div>

All 20 variants:

<div data-table-scroll style="overflow-x: auto" tabindex="0" role="region" aria-label="uncontended read, write, and counter">

| Mechanism                                             | Read, ns | Write, ns | Counter, ns |
| ----------------------------------------------------- | -------: | --------: | ----------: |
| `Mutex`                                               |     1.85 |      1.85 |        1.86 |
| `OSAllocatedUnfairLock`                               |     1.86 |      1.86 |        1.86 |
| `os_unfair_lock`                                      |     1.86 |      1.86 |        1.85 |
| `DispatchSemaphore`                                   |     3.72 |      3.72 |        3.74 |
| `pthread_mutex`                                       |     4.59 |      4.60 |        4.62 |
| `pthread_rwlock`                                      |     6.14 |      6.07 |        6.00 |
| `NSLock`                                              |     6.36 |      6.36 |        6.36 |
| `OSAllocatedUnfairLock` with `.adaptiveSpin`          |     8.48 |      8.22 |        8.49 |
| `objc_sync_enter` / `objc_sync_exit`                  |    10.88 |     10.87 |       10.87 |
| `NSRecursiveLock`                                     |    12.72 |     12.72 |       12.72 |
| `Atomic`, acquiring/releasing                         |    0.265 |     0.265 |        1.88 |
| `Atomic`, relaxed                                     |    0.265 |     0.265 |        1.88 |
| `ManagedAtomic`, acquiring/releasing                  |    0.795 |     0.795 |        1.86 |
| `ManagedAtomic`, relaxed                              |    0.795 |     0.795 |        1.88 |
| actor                                                 |    62.64 |     62.03 |       62.77 |
| `@MainActor` from a background task                   |    5,770 |     5,769 |       5,731 |
| Serial `DispatchQueue`                                |   199.42 |    107.47 |       88.23 |
| Concurrent queue, writes via `sync(flags: .barrier)`  |   204.76 |    210.56 |      209.61 |
| Concurrent queue, writes via `async(flags: .barrier)` |   204.94 |    115.66 |      110.42 |
| No synchronization                                    |    0.265 |     0.265 |        0.83 |

</div>

The "No synchronization" row shows how long the loop and the memory access take on their own. I measured it on one thread only; it doesn't protect the state. For writes via `async(flags: .barrier)` the measured time includes waiting for the queue to run every submitted operation. I'll come back to `@MainActor` in the section on actors.

</details>

**`Mutex`, `OSAllocatedUnfairLock`, and `os_unfair_lock` gave the same result.** All three take about 1.86 ns per operation; the differences show up only in the third decimal place. That's expected: on Apple platforms, `Mutex` and `OSAllocatedUnfairLock` are built on the same `os_unfair_lock`. So there's no speed reason to use `os_unfair_lock` with manual `lock()` and `unlock()` calls. `Mutex` is just as fast.

**`pthread_mutex` and `NSLock` are slower, but only by nanoseconds.** `pthread_mutex` takes 4.6 ns per operation and `NSLock` 6.4 ns, which is 2.5 and 3.4 times as long as `Mutex`. In absolute terms, though, `NSLock` adds about 4.5 ns per operation. If an app takes the lock 10,000 times a second, the whole difference adds up to 45 µs in that second. So the 3.4× ratio doesn't mean the app will get faster once you replace `NSLock` with `Mutex`.

**`Atomic` is the fastest at reads and writes and ties with `Mutex` on the counter.** A read or a write takes 0.27 ns, seven times faster than `Mutex`. An increment takes 1.88 ns, the same as under a lock: it's a single atomic operation, but a costlier one than a plain read or write.

**The actor and the queues are tens of times more expensive.** A call to the actor takes about 63 ns for any of the three operations, 34 times as long as a counter increment under `Mutex`. The serial queue takes 88 to 199 ns, depending on the operation. The operation itself is tiny, so these numbers mostly show the cost of calling into the actor or the queue.

In Marin Todorov's benchmark the actor came out slower than the serial queue; in mine it's the other way around. The main reason, I think, is where the actor is called from. In his test, the `Task` is created in a SwiftUI button handler and inherits `MainActor` isolation, so every call moves execution from the main thread to the actor and back. In my test, a background task calls the actor, and the main thread isn't involved. The section on actors shows what a call from `MainActor` costs.

There's also one result I can't explain: a read through the serial queue took 199 ns and a counter increment 88 ns, although both go through `queue.sync`.

### Two threads on one counter

Now two threads increment the same counter at the same time. Here I compare operations per second across both threads.

<bench-chart chart="two-threads">
<p>Counter increments per second with one and two threads. Mutex: 539 and 102 million, OSAllocatedUnfairLock: 539 and 99 million, pthread_mutex: 216 and 22 million, NSLock: 157 and 15 million, Atomic: 532 and 310 million.</p>
</bench-chart>

<details class="research-data">
  <summary>View data<span class="sr-only">: one thread against two threads</span></summary>

<div data-table-scroll style="overflow-x: auto" tabindex="0" role="region" aria-label="one thread against two threads">

| Mechanism               | One thread, M ops/s | Two threads, M ops/s |
| ----------------------- | ------------------: | -------------------: |
| `Mutex`                 |                 539 |                  102 |
| `OSAllocatedUnfairLock` |                 539 |                   99 |
| `pthread_mutex`         |                 216 |                   22 |
| `NSLock`                |                 157 |                   15 |
| `Atomic`                |                 532 |                  310 |

</div>

</details>

Throughput drops for every mechanism: about fivefold for `Mutex` and by a factor of 1.7 for `Atomic`. With two threads, `Atomic` completes three times as many operations per second as `Mutex`, even though they were equal on one thread.

The benchmark also has six- and twelve-thread variants, described in the [repository](https://github.com/ivan-magda/swift-synchronization-benchmarks/tree/main/Experiments/BaseComparison).

### iPhone 11 Pro Max

The overall picture is the same on the older phone. `Mutex`, `OSAllocatedUnfairLock`, and `os_unfair_lock` are again indistinguishable at about 9.5 ns. The actor takes about 65 ns, and the serial queue 199 ns on the counter.

There are three differences:

- `NSLock` and `pthread_mutex` barely trail `Mutex`: 10.6 and 10.3 ns versus 9.5 ns.
- Memory ordering matters for `Atomic` here: an increment takes 8.3 ns with acquiring/releasing ordering and 2.3 ns with relaxed.
- With two threads, the ranking flips. `NSLock` and `pthread_mutex` complete 52 and 55 million operations per second, while `Mutex` manages 21 million. On the iPhone 15 Pro Max it was the other way around: 102 million for `Mutex` versus 15 and 22 million.

### Takeaway

For a short synchronous operation on shared state, start with `Mutex`. It's as fast as `os_unfair_lock` and needs no manual `lock()` and `unlock()` calls.

`Atomic` is worth considering when one atomic operation is enough: a read, a replacement of the value, or a counter increment. There it's no slower than `Mutex` when uncontended and clearly faster when two threads compete for the counter.

Calling an actor or a queue for every tiny operation is expensive: the call takes tens of times longer than acquiring a lock.

In real apps, though, a lock usually protects more than a single number. In the next section, several threads work with a shared dictionary.

## Synchronizing access to a dictionary

Now the lock protects a dictionary that maps identifiers to request objects. Each new request is added to the dictionary and removed when it finishes. Sometimes all the remaining requests have to be canceled at once.

Networking and image-loading libraries deal with this task. I modeled the experiment on [`runningOperations` in SDWebImage](https://github.com/SDWebImage/SDWebImage/blob/master/SDWebImage/Core/SDWebImageManager.m) and [`RequestTaskMap` in Alamofire](https://github.com/Alamofire/Alamofire/blob/master/Source/Core/RequestTaskMap.swift). What I test here is my own implementation of a similar task; the benchmark makes no real network requests.

In the test, several threads use the dictionary at the same time. Each thread alternately removes an old request and adds a new one, doing a little work outside the lock between accesses. One of the threads also cancels every request and clears the dictionary after every 1,024 of its own accesses.

I tested two modes:

- **with pauses:** after each access the thread sleeps for 50 µs;
- **without pauses:** the threads access the dictionary continuously.

Each mode runs with four and with eight threads. Eight is more than the phone's six cores can run at once.

There are two metrics. Call time is how long one `add` or `remove` takes, including the wait for the lock; I report its p50 and p99. Operations per second counts all threads together and includes the work outside the lock and the pauses.

### What I measured

Here is the dictionary protected with `Mutex`:

```swift
final class MutexRegistry {
    private let downloads = Mutex<[Int: Download]>([:])

    func add(_ download: Download, id: Int) {
        downloads.withLock { downloads in
            downloads[id] = download
        }
    }

    func remove(id: Int) -> Download? {
        downloads.withLock { downloads in
            downloads.removeValue(forKey: id)
        }
    }

    func cancelAll() -> Int {
        downloads.withLock { downloads in
            let count = downloads.count
            for download in downloads.values {
                download.cancel()
            }
            downloads.removeAll(keepingCapacity: true)
            return count
        }
    }
}
```

The comparison covers ten mechanisms: the locks from the previous section and a serial queue. One variant needs a word of explanation: `OSAllocatedUnfairLock` can be acquired with the `.adaptiveSpin` flag, available since iOS 18:

```swift
downloads.withLock(flags: .adaptiveSpin) { downloads in
    downloads[id] = download
}
```

With this flag, a thread that fails to get the lock doesn't go to sleep right away. It first spins briefly while the lock's owner is running on another core. In the previous section, this variant was 4.6 times slower than the plain lock. Here the result is different.

The code for all variants is in the [repository](https://github.com/ivan-magda/swift-synchronization-benchmarks/tree/main/Experiments/RequestRegistry).

### With pauses between accesses

When the threads pause, the choice of mechanism barely affects overall throughput. With four threads, all ten variants complete between 57.3 and 57.8 thousand operations per second, a spread of less than 1%. With eight threads the picture is the same: 110.1 to 110.8 thousand.

Individual call times do differ. With four threads, `Mutex` has a p99 of 0.125 µs and the serial queue 3.75 µs, 30 times as much. But the threads spend nearly all their time pausing and working outside the lock, so the difference doesn't affect the overall result.

### Without pauses

Without pauses, the threads compete for the lock constantly, and the differences between mechanisms become visible. The results below are for eight threads. Operations per second come first; longer bars are faster.

<bench-chart chart="dictionary-throughput">
<p>Dictionary operations per second with eight threads and no pauses. OSAllocatedUnfairLock with adaptiveSpin 1.12 million, OSAllocatedUnfairLock 1.08 million, Mutex 1.06 million, os_unfair_lock 1.04 million, objc_sync 0.99 million, NSRecursiveLock 0.91 million, NSLock 0.89 million, pthread_mutex 0.89 million, DispatchSemaphore 0.20 million, serial DispatchQueue 0.18 million.</p>
</bench-chart>

Operations per second doesn't show how often a single call gets stuck waiting. The p99 of call time does, and here shorter bars are better.

<bench-chart chart="dictionary-p99">
<p>p99 of call time with eight threads and no pauses. OSAllocatedUnfairLock with adaptiveSpin 2.1 µs, Mutex 19.1 µs, OSAllocatedUnfairLock 22.5 µs, DispatchSemaphore 47.3 µs, NSRecursiveLock 50.4 µs, pthread_mutex 51.7 µs, NSLock 51.8 µs, serial DispatchQueue 64.1 µs, os_unfair_lock 67.0 µs, objc_sync 68.6 µs.</p>
</bench-chart>

<details class="research-data">
  <summary>View data<span class="sr-only">: dictionary with eight threads and no pauses</span></summary>

<div data-table-scroll style="overflow-x: auto" tabindex="0" role="region" aria-label="dictionary with eight threads and no pauses">

| Mechanism                                    | Call p50, µs | Call p99, µs | M ops/s |
| -------------------------------------------- | -----------: | -----------: | ------: |
| `OSAllocatedUnfairLock` with `.adaptiveSpin` |         0.42 |         2.08 |    1.12 |
| `OSAllocatedUnfairLock`                      |         0.29 |        22.54 |    1.08 |
| `Mutex`                                      |         0.29 |        19.06 |    1.06 |
| `os_unfair_lock`                             |         0.38 |        67.02 |    1.04 |
| `objc_sync_enter` / `objc_sync_exit`         |         0.50 |        68.61 |    0.99 |
| `NSRecursiveLock`                            |         0.33 |        50.43 |    0.91 |
| `NSLock`                                     |         0.33 |        51.79 |    0.89 |
| `pthread_mutex`                              |         0.38 |        51.69 |    0.89 |
| `DispatchSemaphore`                          |        38.46 |        47.27 |    0.20 |
| Serial `DispatchQueue`                       |        40.06 |        64.10 |    0.18 |

</div>

</details>

**The serial queue and `DispatchSemaphore` fall behind by a factor of five to six.** They complete 0.18 and 0.20 million operations per second versus 1.06 million for `Mutex`. A typical call through the queue takes 40 µs; under `Mutex` it takes 0.29 µs.

**`NSLock` and `pthread_mutex` trail `Mutex` by about 15%.** Both complete 0.89 million operations per second, with a p99 of 52 µs versus 19 µs for `Mutex`.

**Once again, `os_unfair_lock` offered no advantage.** Its throughput is almost the same as that of `Mutex`, and its p99 is three and a half times higher: 67 versus 19 µs.

**The `.adaptiveSpin` flag shortens the rare long calls.** Compared with `Mutex`, p99 fell from 19 to 2 µs, and operations per second rose by about 6%. A typical call got slower, though: p50 went from 0.29 to 0.42 µs. The result with four threads is similar: p99 dropped from 6 to 1.6 µs.

With eight threads, canceling all requests typically takes 25 µs with `Mutex`, 14 µs with `.adaptiveSpin`, and 42 µs with the serial queue.

### iPhone 11 Pro Max

The older phone shows the same picture. With pauses and four threads, every mechanism completes between 55.5 and 56.5 thousand operations per second. Without pauses and with eight threads, the serial queue is five times slower than `Mutex`: 0.14 versus 0.74 million operations per second. The `.adaptiveSpin` flag lowers p99 from 48 to 2.9 µs and adds about 5% to throughput.

### Takeaway

`Mutex` is a good choice for a dictionary too. Among the ordinary locks, it was near the top in both operations per second and p99.

If the threads are busy with other work between dictionary accesses, the synchronization mechanism barely affects the overall result.

When accesses are continuous, the serial queue and `DispatchSemaphore` lose to the locks by a wide margin. And the `.adaptiveSpin` flag, which lost on the simple counter, cut the rare long calls ninefold here. It's worth testing when the slowest calls matter.

In the next section, the state is simple again: a single flag that is read often and changed rarely.

## What it costs to read a feature flag

Picture a feature flag that decides which branch of code runs. The app checks its value often and updates it far less often. If the reads and the writes happen on different threads, access to the flag has to be synchronized.

Almost every app has flags like this. An interesting case: in [Pocket Casts](https://github.com/Automattic/pocket-casts-ios/pull/5186), every such flag used to create its own serial queue and call `sync` on each read, until the queue was replaced with a lock. In [SDWebImage](https://github.com/SDWebImage/SDWebImage/blob/master/SDWebImage/Core/SDWebImageManager.m), the `isCancelled` flag is protected with `@synchronized`.

In the test, a background thread reads the flag continuously while the main thread toggles it about every 10 ms. I compare the time of a single read.

### What I measured

Reading the flag under `Mutex`:

```swift
let isFeatureEnabled = Mutex<Bool>(false)

let enabled = isFeatureEnabled.withLock { value in
    value
}
```

The same read with `Atomic`:

```swift
let isFeatureEnabled = Atomic<Bool>(false)

let enabled = isFeatureEnabled.load(ordering: .acquiring)
```

The comparison covers 17 variants; the code is in the [repository](https://github.com/ivan-magda/swift-synchronization-benchmarks/tree/main/Experiments/HotFlag).

### Results

`Atomic` and the locks come first. The chart shows the time of one read; shorter bars are faster.

The queues don't fit on this scale either. The switch above the chart adds them.

<bench-chart chart="flag">
<p>Flag read time for Atomic and the locks. Atomic 0.3 ns, ManagedAtomic 0.8 ns, Mutex, OSAllocatedUnfairLock, and os_unfair_lock 1.9 ns each, DispatchSemaphore 3.7 ns, pthread_mutex 4.6 ns, pthread_rwlock 6.1 ns, NSLock 6.5 ns, OSAllocatedUnfairLock with adaptiveSpin 8.9 ns, objc_sync 11.2 ns, NSRecursiveLock 13.2 ns. With the queues added: serial DispatchQueue 202.8 ns, concurrent queue with an async barrier 207.3 ns, concurrent queue with a sync barrier 207.9 ns.</p>
</bench-chart>

<details class="research-data">
  <summary>View data<span class="sr-only">: flag read time</span></summary>

<div data-table-scroll style="overflow-x: auto" tabindex="0" role="region" aria-label="flag read time">

| Mechanism                                             | Read, ns | Relative to `Mutex` |
| ----------------------------------------------------- | -------: | ------------------: |
| `Atomic`                                              |     0.32 |                0.2× |
| `ManagedAtomic`                                       |     0.80 |                0.4× |
| `Mutex`                                               |     1.86 |                1.0× |
| `OSAllocatedUnfairLock`                               |     1.86 |                1.0× |
| `os_unfair_lock`                                      |     1.86 |                1.0× |
| `DispatchSemaphore`                                   |     3.74 |                2.0× |
| `pthread_mutex`                                       |     4.56 |                2.5× |
| `pthread_rwlock`                                      |     6.10 |                3.3× |
| `NSLock`                                              |     6.47 |                3.5× |
| `OSAllocatedUnfairLock` with `.adaptiveSpin`          |     8.89 |                4.8× |
| `objc_sync_enter` / `objc_sync_exit`                  |    11.24 |                6.0× |
| `NSRecursiveLock`                                     |    13.20 |                7.1× |
| Serial `DispatchQueue`                                |   202.78 |                109× |
| Concurrent queue, writes via `async(flags: .barrier)` |   207.31 |                111× |
| Concurrent queue, writes via `sync(flags: .barrier)`  |   207.85 |                112× |

</div>

</details>

**`Atomic` reads the flag fastest.** One read takes 0.32 ns, almost six times faster than `Mutex`. In the first experiment, nothing changed the value during the reads. Here another thread does, and `Atomic` keeps its advantage. `ManagedAtomic` from the [swift-atomics](https://github.com/apple/swift-atomics) package, which also works before iOS 18, beats the locks as well: 0.80 ns.

**`Mutex`, `OSAllocatedUnfairLock`, and `os_unfair_lock` are tied.** All three take 1.86 ns per read; `NSLock` takes 6.5 ns.

**`pthread_rwlock` didn't help.** A read under it takes 6.1 ns, three times as long as under `Mutex`. There is only one reading thread here, so no reads can run in parallel.

**A read through a queue takes a hundred times as long as under `Mutex`.** With the serial queue it takes 203 ns, with a concurrent queue about 207 ns.

To get a sense of scale, multiply these numbers by the read rate. If the flag is read 10,000 times a second, all the reads in that second take 3 µs with `Atomic`, 19 µs with `Mutex`, and 2 ms with the serial queue.

### iPhone 11 Pro Max

The picture is the same on the older phone: `Atomic` 0.61 ns, `Mutex` 9.1 ns, serial queue 407 ns. Memory ordering matters for `Atomic` on this phone: a relaxed read takes 0.46 ns, a quarter less than an acquiring one. On the iPhone 15 Pro Max, the two gave the same result.

### Takeaway

For a flag that is read often, `Atomic` is the fastest option.

`Mutex` is still a good choice: the difference from `Atomic` is 1.5 ns per read.

Creating a queue to read a flag is expensive. A read through it takes a hundred times as long as under `Mutex`. This is the design [Pocket Casts](https://github.com/Automattic/pocket-casts-ios/pull/5186) moved away from.

Next, several threads read at once.

## Many reads, few writes: do you need a read-write lock?

When data is mostly read, an ordinary lock looks like a needless restriction: while one thread reads, the others wait, even though nothing is changing. That leads to the familiar answer: a read-write lock or a concurrent queue with a barrier. With those, several threads can read at once, while writes run one at a time.

Well-known libraries do this too. In [Apollo iOS 1.x](https://github.com/apollographql/apollo-ios/blob/1.25.7/Sources/Apollo/ApolloStore.swift), the cache is read through a concurrent queue and written with `async(flags: .barrier)`. In [swift-log](https://github.com/apple/swift-log/blob/1.17.0/Sources/Logging/LoggingSystem.swift), the `LoggingSystem` settings are read under a `pthread_rwlock`.

The feature flag section had a single reading thread, so nothing could read in parallel. Now there are six threads working with an array of 10,000 records: 98% of the operations read data and 2% change it. Let's see whether that ratio is enough for a read-write lock to beat `Mutex`.

### What I measured

I tested two variants. In the first, each operation reads or changes one record. In the second, it works with a group of twenty records at once. That makes each read longer, so the threads' reads overlap more often. If a read-write lock can beat `Mutex` anywhere, it's here.

There are two metrics: operations per second across all threads, and the p99 of write time.

Reading a group under `Mutex`:

```swift
let records = Mutex<[Record]>(initialRecords)

let result = records.withLock { records in
    records.readGroup(group, size: groupSize)
}
```

A write looks the same, except that it calls `writeGroup` instead of `readGroup`.

With `pthread_rwlock`, reads and writes acquire the lock differently:

```swift
// Read: several threads can read at once
pthread_rwlock_rdlock(lock)
let result = records.readGroup(group, size: groupSize)
pthread_rwlock_unlock(lock)

// Write: the thread has the data to itself
pthread_rwlock_wrlock(lock)
records.writeGroup(group, size: groupSize)
pthread_rwlock_unlock(lock)
```

With a concurrent queue, reads go through `sync` and writes through `sync` with the `.barrier` flag:

```swift
let queue = DispatchQueue(label: "store", attributes: .concurrent)

let result = queue.sync {
    records.readGroup(group, size: groupSize)
}

queue.sync(flags: .barrier) {
    records.writeGroup(group, size: groupSize)
}
```

A second queue variant submits the write with `async(flags: .barrier)`. In that variant, a write counts as done when its block has run, not when the call returns.

The comparison covers 13 variants; the code is in the [repository](https://github.com/ivan-magda/swift-synchronization-benchmarks/tree/main/Experiments/TransactionalStore).

### Results

First, operations per second for groups of twenty records; longer bars are faster.

<bench-chart chart="store-throughput">
<p>Operations per second with six threads and groups of twenty records. OSAllocatedUnfairLock 9.50 million, Mutex 9.37 million, pthread_mutex 9.29 million, os_unfair_lock 8.60 million, NSLock 8.05 million, NSRecursiveLock 7.14 million, OSAllocatedUnfairLock with adaptiveSpin 5.80 million, pthread_rwlock 3.07 million, objc_sync 2.89 million, concurrent queue with a sync barrier 1.60 million, concurrent queue with an async barrier 1.47 million, DispatchSemaphore 1.05 million, serial DispatchQueue 0.45 million.</p>
</bench-chart>

Writes make up only 2% of the operations, but they need access to the data too. The p99 of write time shows how long they wait, measured from the call to the moment the data has changed. Here shorter bars are better.

<bench-chart chart="store-write-p99">
<p>p99 of write time with six threads and groups of twenty records. OSAllocatedUnfairLock with adaptiveSpin 6.2 µs, os_unfair_lock 6.4 µs, Mutex 8.0 µs, DispatchSemaphore 8.0 µs, OSAllocatedUnfairLock 8.3 µs, objc_sync 10.7 µs, pthread_mutex 14.9 µs, NSLock 16.5 µs, NSRecursiveLock 16.9 µs, pthread_rwlock 21.8 µs, serial DispatchQueue 27.3 µs, concurrent queue with a sync barrier 29.6 µs, concurrent queue with an async barrier 33.7 µs.</p>
</bench-chart>

<details class="research-data">
  <summary>View data<span class="sr-only">: store with 98% reads</span></summary>

<div data-table-scroll style="overflow-x: auto" tabindex="0" role="region" aria-label="store with 98% reads">

| Mechanism                                             | One record, M ops/s | Twenty records, M ops/s | Twenty records, write p99, µs |
| ----------------------------------------------------- | ------------------: | ----------------------: | ----------------------------: |
| `OSAllocatedUnfairLock`                               |               34.67 |                    9.50 |                          8.29 |
| `Mutex`                                               |               34.81 |                    9.37 |                          7.96 |
| `pthread_mutex`                                       |               35.10 |                    9.29 |                         14.94 |
| `os_unfair_lock`                                      |               33.35 |                    8.60 |                          6.44 |
| `NSLock`                                              |               22.48 |                    8.05 |                         16.52 |
| `NSRecursiveLock`                                     |               14.62 |                    7.14 |                         16.85 |
| `OSAllocatedUnfairLock` with `.adaptiveSpin`          |               10.40 |                    5.80 |                          6.21 |
| `pthread_rwlock`                                      |                3.88 |                    3.07 |                         21.77 |
| `objc_sync_enter` / `objc_sync_exit`                  |                3.12 |                    2.89 |                         10.67 |
| Concurrent queue, writes via `sync(flags: .barrier)`  |                1.69 |                    1.60 |                         29.56 |
| Concurrent queue, writes via `async(flags: .barrier)` |                2.09 |                    1.47 |                         33.69 |
| `DispatchSemaphore`                                   |                1.10 |                    1.05 |                          8.02 |
| Serial `DispatchQueue`                                |                0.46 |                    0.45 |                         27.31 |

</div>

</details>

**`pthread_rwlock` is slower than the ordinary locks.** With groups of twenty records it completes 3.07 million operations per second, a third of the 9.37 million that `Mutex` manages. With one record the gap is ninefold: 3.88 versus 34.81 million. Reads make up 98% of the operations, yet reading in parallel didn't pay off.

The most likely reason is how short the operations are. `pthread_rwlock` is more expensive in itself: in the flag section, a read under it took 6.1 ns versus 1.86 ns under `Mutex`. Reading twenty records from memory is too short for parallel reads to make up that difference.

**A concurrent queue with a barrier is slower still.** With groups of twenty records it completes 1.60 million operations per second with `sync(flags: .barrier)` and 1.47 million with `async(flags: .barrier)`, roughly a sixth of what `Mutex` does. Replacing `sync` with `async` gives no consistent gain: `async` is faster with one record (2.09 versus 1.69 million) and slower with twenty.

**`Mutex`, `OSAllocatedUnfairLock`, and `pthread_mutex` are neck and neck.** With twenty records they complete 9.29 to 9.50 million operations per second, and with one record 34.67 to 35.10 million. `NSLock` falls behind: 8.05 and 22.48 million.

**Writes wait longest in the queues and under `pthread_rwlock`.** The write p99 is 8.0 µs for `Mutex`, 21.8 µs for `pthread_rwlock`, and for the concurrent queue 29.6 µs with `sync` and 33.7 µs with `async`. `pthread_mutex` matches `Mutex` in throughput, but its write p99 is almost twice as high: 14.9 µs.

**The `.adaptiveSpin` flag didn't pay off here.** In the dictionary section it cut p99 ninefold. Here the write p99 fell from 8.3 to 6.2 µs, but operations per second dropped from 9.50 to 5.80 million.

### iPhone 11 Pro Max

On the older phone, `Mutex` is still faster than `pthread_rwlock` and the queues, but the gap is smaller. With twenty records, `pthread_rwlock` completes 3.45 million operations per second versus 4.26 million for `Mutex`: 19% behind instead of a factor of three. The concurrent queue with a barrier is more than three times slower than `Mutex` here. With one record, `pthread_rwlock` is almost four times slower: 3.99 versus 15.59 million.

### Takeaway

A high share of reads isn't reason enough to reach for a read-write lock or a concurrent queue with a barrier. On short in-memory operations, `Mutex` was faster than both.

The operations in this test are short. If a read under the lock takes a long time, parallel reads may pay off, and that's worth measuring in your own code.

Next, we turn to asynchronous code and compare actors with locks.

## Are actors really slow?

"Actors are slow, use a lock." The first experiment seems to support that advice: there, a call to an actor costs 34 times as much as acquiring a `Mutex`. But I tested only one way of calling the actor: a single background task calling it in a loop.

In an app, actors get called in different ways: from the main thread, from dozens of tasks at once, with one operation per `await` or a hundred.

And more and more code is built on actors, with entire libraries moving to them. [Nuke 13](https://github.com/kean/Nuke/releases/tag/13.0.0) replaced its internal serial queue with a global actor, `ImagePipelineActor`. In [Apollo iOS 2.0](https://github.com/apollographql/apollo-ios/blob/2.5.0/Sources/Apollo/Internal%20Utilities/AsyncReadWriteLock.swift), the cache is protected by an asynchronous read-write lock that is itself written as an actor.

I'll start with the question left over from the first experiment. In Marin Todorov's benchmark the actor was slower than the serial queue; in mine it was the other way around. My guess was `MainActor`: in his test, the actor was called from the main thread. Now I can test that guess.

### What I measured

The counter is the same as in the first experiment. Only the way it's called changes.

```swift
actor CounterActor {
    private var value = 0

    func increment() {
        value &+= 1
    }
}
```

It can be called from a background task:

```swift
Task.detached {
    for _ in 0..<count {
        await counter.increment()
    }
}
```

Or from `MainActor`. The loop is the same, but after every `await`, execution returns to the main thread:

```swift
@MainActor
func incrementFromMainActor() async {
    for _ in 0..<count {
        await counter.increment()
    }
}
```

For comparison, here is the same counter under `Mutex`. Even in asynchronous code, a lock is acquired synchronously, with no `await`:

```swift
let value = Mutex(0)

value.withLock { $0 &+= 1 }
```

The code for all variants is in the [repository](https://github.com/ivan-magda/swift-synchronization-benchmarks/tree/main/Experiments/AsyncCode).

### Where the actor is called from

The chart shows the time of one counter increment for each way of calling; shorter bars are faster.

<bench-chart chart="actor-paths">
<p>Time of one counter increment. Mutex 1.9 ns, actor called from inside the actor 8.8 ns, actor called from a background task 52.6 ns, actor called from MainActor 4,891 ns, MainActor called from a background task 5,723 ns.</p>
</bench-chart>

<details class="research-data">
  <summary>View data<span class="sr-only">: ways of calling the actor</span></summary>

<div data-table-scroll style="overflow-x: auto" tabindex="0" role="region" aria-label="ways of calling the actor">

| How the counter is incremented             | Time per operation |
| ------------------------------------------ | -----------------: |
| `Mutex`, from any thread                   |            1.86 ns |
| Actor, code already running on it          |            8.77 ns |
| Actor, called from a background task       |           52.61 ns |
| Actor, called from `MainActor`             |            4.89 µs |
| `MainActor`, called from a background task |            5.72 µs |

</div>

</details>

**The guess held up: a call from the main thread costs 93 times as much.** A background task spends 52.6 ns on one call to the actor. Code on `MainActor` spends 4.89 µs, or 4,891 ns. The counter and the actor are the same; only the call site changed. The opposite direction looks similar: when a background task updates state on `MainActor`, one call takes 5.72 µs.

That's enough to explain Todorov's result. In the first experiment, an operation on the serial queue took 88 to 199 ns. A call to the actor from a background task is faster than that; a call from `MainActor` is tens of times slower.

For a sense of scale: a hundred calls in a row from `MainActor` to an actor take about 0.5 ms. A frame at 120 Hz lasts 8.3 ms.

The animation below traces the calls. Switch between them to see where the time goes.

<actor-hops>
<p>Three ways to update a counter in an actor. Called from a background task, each await suspends the task and runs on the actor: 52.6 ns per call. Called from MainActor, each await leaves the main thread and comes back: 4.89 µs per call. With a hundred updates in one await the call is paid once: 1.23 ns per update.</p>
</actor-hops>

### Is it the actor or the main thread?

A test with no actor at all answers that. `MainActor` code calls an ordinary short `async` function, and I check which thread its body runs on and how long the call takes:

```swift
nonisolated func work() async { … }

@concurrent
func concurrentWork() async { … }
```

I built the first function with two sets of project settings, so there are three variants:

| Variant                                                                                                           | Where the function ran | Time per call |
| ----------------------------------------------------------------------------------------------------------------- | ---------------------- | ------------: |
| `nonisolated async`, new-project settings in Xcode 27: Approachable Concurrency and default `MainActor` isolation | On the main thread     |       8.82 ns |
| `nonisolated async`, Swift 6 without Approachable Concurrency                                                     | Off the main thread    |       5.58 µs |
| `@concurrent`, new-project settings in Xcode 27                                                                   | Off the main thread    |       5.60 µs |

_iPhone 15 Pro Max, iOS 26.6.2, Release build. Median of 12 launches._

**The cost is in the thread switch, with or without an actor.** The `@concurrent` function ran off the main thread, and each call took 5.60 µs. That's even slightly more than a call to an actor from `MainActor` (4.89 µs), although no actor is involved. So about 5 µs goes to switching from the main thread to a background thread and back.

**With new-project settings, a `nonisolated async` function stays on the main thread.** Called from `MainActor`, the `nonisolated async` function stayed on the main thread in every call, and each call took 8.8 ns. In Swift 6 mode without Approachable Concurrency, the same function ran off the main thread at 5.58 µs per call. [SE-0461](https://github.com/swiftlang/swift-evolution/blob/main/proposals/0461-async-function-isolation.md) describes the rules.

The fast call in the first row doesn't make that variant better: any heavy work in it stays on the main thread too.

That settles the main thread. But even without it, a call to an actor costs 52.6 ns, 28 times as much as acquiring a `Mutex`. And that's a single task with nothing in its way. What happens with many tasks?

### 50 tasks on one counter

Fifty tasks call one counter at the same time, 1,000 calls each. Here I time every call individually and look at p99.

<bench-chart chart="actor-many-tasks">
<p>p99 of call time with 50 tasks. OSAllocatedUnfairLock 6.0 µs, Mutex 6.3 µs, NSLock 11.4 µs, actor 24.9 µs.</p>
</bench-chart>

**The gap remains under load.** `Mutex` and `OSAllocatedUnfairLock` have a p99 of about 6 µs, `NSLock` 11.4 µs, and the actor 24.9 µs. The typical call differs too: the actor's median is 19 µs, while the locks' is under 0.1 µs. At every `await`, a task yields to the others and waits its turn. With a lock, it usually reaches the counter right away.

In all of these tests, a single call to an actor costs more than acquiring a lock. But we pay per call, not for the work inside it. That leads to the last check: what if we call less often and do more per call?

### A hundred updates in one await

The state here is an array of 128 counters. In the first variant, every update gets its own `await`; in the second, one call performs a hundred updates:

```swift
actor CounterGroupActor {
    private var counters = [Int](repeating: 0, count: 128)

    func incrementOne(at index: Int) {
        counters[index % 128] &+= 1
    }

    func incrementGroup(startingAt start: Int) {
        for index in start..<(start + 100) {
            counters[index % 128] &+= 1
        }
    }
}
```

Here is how it looks at the call site. The first variant makes a hundred calls:

```swift
for index in 0..<100 {
    await counters.incrementOne(at: index)
}
```

The second makes one:

```swift
await counters.incrementGroup(startingAt: 0)
```

The work is the same in both: a hundred separate increments in the array, not one addition of 100.

<bench-chart chart="actor-batching">
<p>Time per update. Actor with an await per update 58.08 ns, actor with a hundred updates in one await 1.23 ns, Mutex with a hundred updates under one lock 0.69 ns.</p>
</bench-chart>

**Batching made the actor 47 times faster.** With an `await` per update, one update takes 58.1 ns; in a batch of a hundred, it takes 1.23 ns. `Mutex` with the same batching is still faster at 0.69 ns. But the gap between them is now half a nanosecond per update, down from about 50 ns without batching.

Batching isn't always an option: while the actor runs a hundred updates, every other call to it waits.

### iPhone 11 Pro Max

The older phone shows the same picture. A call to the actor takes 64.6 ns from a background task and 6.0 µs from `MainActor`. Batching makes the actor 49 times faster: from 80.2 to 1.63 ns per update. With 50 tasks, the actor's p99 is 35.4 µs versus 9.4 µs for `Mutex`. One thing differs: `NSLock` has a p99 of 33.5 µs here, almost as high as the actor's.

### Takeaway

Actors aren't slow in themselves. The cost of a call depends on where it comes from and how much work it does.

The most expensive part is switching between the main thread and a background thread: about 5 µs for the round trip, with or without an actor. If that happens in a loop, look there first.

If state already lives in an actor, hand it related operations in a single call. In the test, that made the actor 47 times faster.

For a short synchronous operation, `Mutex` remains the cheapest option, even in asynchronous code. The two work well together: in Nuke 13, an actor manages the tasks, while small state that has to be read synchronously is still protected by a lock.

In the next section, the main thread reads an image cache during scrolling.

## An image cache during scrolling

"Don't block the main thread." Every iOS developer knows the rule. And yet image caches are read on the main thread: `cellForItemAt` pulls an image out of memory while background threads put new ones in. So during scrolling, the main thread takes a lock itself and occasionally waits for a background thread to release it.

[Nuke](https://github.com/kean/Nuke/blob/13.2.3/Sources/NukeUI/LazyImageView.swift#L299), for example, works this way: `LazyImageView` checks the cache on the main thread before starting a load, and the cache itself is protected by an `os_unfair_lock`. In [SDWebImage](https://github.com/SDWebImage/SDWebImage/blob/5.21.7/SDWebImage/Core/SDMemoryCache.m#L104), part of the memory cache also sits behind an `os_unfair_lock`.

I wanted to know two things. How long does such a read take with different synchronization mechanisms? And is it noticeable during scrolling?

### What I measured

The test uses a real `UICollectionView`: a four-column grid scrolled at a constant speed by a `CADisplayLink`. When UIKit asks for a cell, its image comes from the cache:

```swift
func collectionView(_ collectionView: UICollectionView,
                    cellForItemAt indexPath: IndexPath) -> UICollectionViewCell {
    let cell = collectionView.dequeueReusableCell(
        withReuseIdentifier: "image", for: indexPath) as! ImageCell
    cell.imageView.image = cache.image(for: key(at: indexPath))?.image
    return cell
}
```

The cache is a dictionary that maps a URL string to a ready-to-use image. Here is the `Mutex` variant:

```swift
final class MutexImageCache {
    private let images = Mutex<[String: CachedImage]>([:])

    func image(for key: String) -> CachedImage? {
        images.withLock { $0[key] }
    }

    func store(_ entry: CachedImage, for key: String) {
        images.withLock { $0[key] = entry }
    }
}
```

During the scroll, four background threads replace images in the cache. Before each write, a thread does some computation outside the lock, as if decoding an image; after the write, it sleeps for 700 ms. The cache is filled in advance, so every read finds an image.

There are two metrics. Read time is the duration of the `cache.image(for:)` call; the rest of the cell's work isn't included. To catch hitches, the moments when the main thread misses the next frame, I measured the intervals between `CADisplayLink` callbacks. On a 120 Hz display, a callback arrives every 8.3 ms. If the main thread stays busy longer than that, the next callback arrives late and the interval grows.

The comparison covers 14 variants; the code is in the [repository](https://github.com/ivan-magda/swift-synchronization-benchmarks/tree/main/Experiments/MainThreadCache).

### How long a read takes

The chart shows the median read time; shorter bars are faster.

<bench-chart chart="cache-read">
<p>Median cache read time during scrolling. Mutex 2.02 µs, OSAllocatedUnfairLock 2.06 µs, MainActor with a direct read 2.10 µs, os_unfair_lock 2.15 µs, pthread_rwlock 2.21 µs, pthread_mutex 2.22 µs, DispatchSemaphore 2.29 µs, NSLock 2.42 µs, objc_sync 2.50 µs, OSAllocatedUnfairLock with adaptiveSpin 2.65 µs, NSRecursiveLock 2.69 µs, serial DispatchQueue 7.94 µs, concurrent queue with a sync barrier 8.21 µs, concurrent queue with an async barrier 8.27 µs.</p>
</bench-chart>

<details class="research-data">
  <summary>View data<span class="sr-only">: cache read time</span></summary>

<div data-table-scroll style="overflow-x: auto" tabindex="0" role="region" aria-label="cache read time">

| Mechanism                                             | Read p50, µs | Read p99, µs |
| ----------------------------------------------------- | -----------: | -----------: |
| `Mutex`                                               |         2.02 |         8.16 |
| `OSAllocatedUnfairLock`                               |         2.06 |         8.56 |
| `MainActor`, direct read                              |         2.10 |         8.29 |
| `os_unfair_lock`                                      |         2.15 |         8.62 |
| `pthread_rwlock`                                      |         2.21 |         8.48 |
| `pthread_mutex`                                       |         2.22 |         8.41 |
| `DispatchSemaphore`                                   |         2.29 |         9.21 |
| `NSLock`                                              |         2.42 |        10.02 |
| `objc_sync_enter` / `objc_sync_exit`                  |         2.50 |         9.00 |
| `OSAllocatedUnfairLock` with `.adaptiveSpin`          |         2.65 |         9.96 |
| `NSRecursiveLock`                                     |         2.69 |         9.93 |
| Serial `DispatchQueue`                                |         7.94 |        19.25 |
| Concurrent queue, writes via `sync(flags: .barrier)`  |         8.21 |        20.21 |
| Concurrent queue, writes via `async(flags: .barrier)` |         8.27 |        19.89 |

</div>

</details>

**A read through a queue takes four times as long.** It takes 2.0 µs under `Mutex`, 7.9 µs through the serial queue, and about 8.2 µs through a concurrent queue. The other locks take 2.1 to 2.7 µs.

**`pthread_rwlock` and `.adaptiveSpin` didn't help here.** A read with them takes 2.21 and 2.65 µs versus 2.02 µs for `Mutex`. The background threads write rarely, and the main thread almost never waits for the lock.

So a queue adds about 6 µs to every read. Is that noticeable during scrolling?

### Is it noticeable during scrolling?

No, it isn't. All 14 variants show the same intervals between `CADisplayLink` callbacks, and not a single interval stretched to even a frame and a half.

That's expected. Hitches usually appear when the main thread is busy with heavy work: complex UI, layout, image decoding. A cache read isn't that kind of work. It takes microseconds, while a frame at 120 Hz lasts 8.3 ms. So the choice of lock doesn't affect how smooth the scrolling is here.

### What if the cache is isolated to MainActor?

Only the main thread reads the cache, so reads don't need a lock: the cache can be isolated to `MainActor`.

```swift
@MainActor
final class MainActorImageCache {
    private var images: [String: CachedImage] = [:]

    func image(for key: String) -> CachedImage? {
        images[key]
    }

    func store(_ entry: CachedImage, for key: String) {
        images[key] = entry
    }
}
```

In the previous section, a call to `MainActor` from a background task took 5.7 µs. But here the main thread does the reading itself, so no thread switch is needed. A read takes 2.10 µs, almost the same as under `Mutex`. The background tasks pay for the thread switch when they write through `await cache.store(…)`, and there are only about six writes per second.

The comparison shows one more thing: a read with no lock at all takes the same 2 µs as a read under `Mutex`. So the lock accounts for almost none of those 2 µs.

### iPhone 11 Pro Max

The older phone's display refreshes at 60 Hz. A read takes 3.1 µs under `Mutex` and 13.7 µs through the serial queue, more than four times as long. Here too, no interval exceeded a frame and a half.

### Takeaway

A short read under a lock doesn't break the "don't block the main thread" rule. Under `Mutex` it takes about 2 µs, while a frame lasts 8.3 ms.

A queue is four times slower, but even that difference isn't noticeable during scrolling. There's no point in replacing a queue with `Mutex` for smoothness here: hitches come from heavy work on the main thread, not from the choice of lock.

If the cache is already isolated to `MainActor`, there's no point in moving it under a lock for read speed either.

All of this holds only while the lock is held briefly. In the next section, a low-priority background thread holds it while the main thread waits.

## Priority inversion: the main thread waits for a background thread

Heavy background work usually runs at low priority so that it doesn't get in the way of the UI. But suppose such a thread takes a lock that the main thread needs. Now the main thread has to wait for the background thread to finish, and the background thread gets no CPU time because the app has higher-priority work to do. The situation is upside down: the most important thread is waiting for the least important one. This is called priority inversion.

Some synchronization mechanisms are designed to solve this problem: while the important thread waits, the system temporarily lends its priority to the thread holding the lock. In this section I check how long the main thread waits in this situation and which mechanisms actually shorten the wait.

### What I measured

One trial goes like this:

1. A thread at `background` priority takes the lock and starts working under it. With no load on the CPU, that work takes about 5 ms.
2. Six threads at `userInitiated` priority occupy all the cores for 300 ms.
3. After 1 ms, the main thread tries to read the state under the same lock.

I measure how long the main thread waits. With `Mutex` it looks like this:

```swift
let state = Mutex(0)

// Background thread, background priority
state.withLock { value in
    doWork()    // about 5 ms with no load
    value = trial
}

// Main thread, 1 ms later
let value = state.withLock { $0 }
```

Each launch runs 100 such trials per mechanism. The comparison covers 14 variants; the code is in the [repository](https://github.com/ivan-magda/swift-synchronization-benchmarks/tree/main/Experiments/PriorityInversion).

### How long the main thread waits

The chart shows the median wait; shorter bars are better.

<bench-chart chart="inversion-wait">
<p>Median main-thread wait. objc_sync 12.95 ms, Mutex 12.95 ms, NSLock 12.96 ms, pthread_mutex 12.96 ms, OSAllocatedUnfairLock with adaptiveSpin 12.97 ms, OSAllocatedUnfairLock 12.97 ms, concurrent queue with an async barrier 13.00 ms, NSRecursiveLock 13.09 ms, os_unfair_lock 13.65 ms, serial DispatchQueue 13.86 ms, concurrent queue with a sync barrier 61.94 ms, DispatchSemaphore 65.63 ms, pthread_rwlock 68.55 ms.</p>
</bench-chart>

<details class="research-data">
  <summary>View data<span class="sr-only">: main-thread wait</span></summary>

<div data-table-scroll style="overflow-x: auto" tabindex="0" role="region" aria-label="main-thread wait">

| Mechanism                                             | Median wait, ms |
| ----------------------------------------------------- | --------------: |
| `objc_sync_enter` / `objc_sync_exit`                  |           12.95 |
| `Mutex`                                               |           12.95 |
| `NSLock`                                              |           12.96 |
| `pthread_mutex`                                       |           12.96 |
| `OSAllocatedUnfairLock` with `.adaptiveSpin`          |           12.97 |
| `OSAllocatedUnfairLock`                               |           12.97 |
| Concurrent queue, writes via `async(flags: .barrier)` |           13.00 |
| `NSRecursiveLock`                                     |           13.09 |
| `os_unfair_lock`                                      |           13.65 |
| Serial `DispatchQueue`                                |           13.86 |
| Concurrent queue, writes via `sync(flags: .barrier)`  |           61.94 |
| `DispatchSemaphore`                                   |           65.63 |
| `pthread_rwlock`                                      |           68.55 |

</div>

</details>

**With ten of the thirteen mechanisms, the wait is the same: about 13 ms.** That's 12.95 ms for `Mutex`, 12.96 ms for `NSLock`, and 13.86 ms for the serial queue.

**Three mechanisms make the main thread wait about five times as long.** The main thread waits 61.9 ms with a concurrent queue and writes via `sync(flags: .barrier)`, 65.6 ms with `DispatchSemaphore`, and 68.6 ms with `pthread_rwlock`.

With the background thread at `utility` priority, the result is the same: about 13 ms for most mechanisms and 55 to 60 ms for the same three.

### Why these three

Apple has the answer. The WWDC 2017 session [Modernizing Grand Central Dispatch Usage](https://developer.apple.com/videos/play/wwdc2017/706/) divides synchronization primitives into three groups:

- **A single known owner**, such as a serial queue or `os_unfair_lock`. The system knows which thread holds the lock and can lend it the waiter's priority.
- **No owner**, such as `DispatchSemaphore`. The system doesn't know which thread will call `signal`, so there's no thread to lend the priority to.
- **Multiple owners**, such as a concurrent queue or a read-write lock. There's no single owner, and the system doesn't pass the priority on.

The three slow mechanisms match the second and third groups exactly. The results fit this explanation: in the fast group, the background thread temporarily gets the main thread's priority and finishes its work; in the slow group, it keeps its own priority and waits for a free core.

Here is one trial as a timeline. Switch the lock to compare the groups.

<inversion-timeline>
<p>A timeline of one trial. A background thread takes the lock, six load threads occupy all the cores, and after 1 ms the main thread asks for the lock. With Mutex the main thread waits 12.95 ms, about a frame and a half at 120 Hz. With DispatchSemaphore it waits 65.63 ms, about eight frames.</p>
</inversion-timeline>

There's one exception I can't explain: the `async(flags: .barrier)` variant landed in the fast group, even though it uses the same concurrent queue.

### 13 ms is still a lot

Even in the fast group, the main thread waited 13 ms. The work under the lock takes only 5 ms, but under load it runs longer. At 120 Hz, 13 ms is a frame and a half: a hitch. And no choice of lock will remove it.

### iPhone 11 Pro Max

On the older phone, the same three mechanisms are slower than the rest, but by less: about 21.5 ms, versus 12 to 14.5 ms for the others.

### Takeaway

If the main thread might wait for a lock, choose a mechanism that handles priority inversion: `Mutex`, `OSAllocatedUnfairLock`, `NSLock`, or a serial queue. With a semaphore, `pthread_rwlock`, or a concurrent queue with `sync(flags: .barrier)`, the main thread waited five times as long.

But even with `Mutex`, the main thread waited 13 ms, which is already a hitch. So what needs to change is the work done under the lock, not the lock itself. Do the computation before acquiring the lock, and keep only a short state update under it.

One question remains: what the lock object itself costs in creation time and memory.

## Creation cost and memory footprint

A lock usually lives inside the object, as a field next to the state it protects. With only a few such objects, nobody gives that field a thought. But sometimes there are thousands of them: cache entries, requests, list items. Then each one has its own lock, queue, or actor, and each of those has to be created, kept in memory, and eventually destroyed.

In this section I check how long it takes to create and destroy such an object and how much memory the synchronization mechanism adds to it.

### What I measured

The object in the test is simple: one integer and the mechanism that protects it. Here are the `Mutex` variant and the variant with its own queue:

```swift
final class MutexObject {
    private let value = Mutex<Int>(0)
}

final class SerialQueueObject {
    private var value = 0
    private let queue = DispatchQueue(label: "creation.serial")
}
```

I create 100,000 such objects in a row, then destroy them, and divide the time by the number of objects. For memory, I read the allocator's counters: how much the number of bytes in use grew after creation, per object. Then I subtract the result for an object with no synchronization. Nothing accesses the objects in this test; they are only created and destroyed.

The comparison covers 15 variants; the code is in the [repository](https://github.com/ivan-magda/swift-synchronization-benchmarks/tree/main/Experiments/CreationCost).

### How long creation takes

The chart shows the time to create one object; shorter bars are faster.

<bench-chart chart="creation-time">
<p>Time to create one object. Mutex 15.3 ns, no synchronization 15.7 ns, Atomic 15.7 ns, MainActor class 16.2 ns, actor 20.7 ns, os_unfair_lock 22.4 ns, ManagedAtomic 23.3 ns, DispatchSemaphore 23.8 ns, OSAllocatedUnfairLock 24.3 ns, pthread_mutex 24.7 ns, pthread_rwlock 25.3 ns, NSLock 26.8 ns, NSRecursiveLock 31.4 ns, concurrent DispatchQueue 114.1 ns, serial DispatchQueue 152.2 ns.</p>
</bench-chart>

**An object with a `Mutex` is created as fast as an object with no synchronization.** They take 15.3 and 15.7 ns. The same goes for `Atomic` and for a `@MainActor` class.

**The other locks add 7 to 16 ns.** `OSAllocatedUnfairLock` takes 24.3 ns, `NSLock` 26.8 ns, and `NSRecursiveLock` 31.4 ns.

**An object with its own queue takes seven to ten times as long to create.** That's 152 ns with a serial queue and 114 ns with a concurrent one. For 100,000 objects, that adds up to 15 ms versus 1.5 ms with `Mutex`.

The memory numbers show where the difference comes from.

### How much memory a mechanism adds

Here each bar shows how many more bytes an object with a synchronization mechanism takes than the same object without one.

<bench-chart chart="creation-memory">
<p>Extra memory per object. Atomic 0 bytes, MainActor class 0, Mutex 16, ManagedAtomic 32, OSAllocatedUnfairLock 32, os_unfair_lock 32, pthread_mutex 80, actor 96, DispatchSemaphore 96, NSLock 112, serial DispatchQueue 160, concurrent DispatchQueue 176, NSRecursiveLock 240, pthread_rwlock 240.</p>
</bench-chart>

<details class="research-data">
  <summary>View data<span class="sr-only">: creation time, destruction time, and extra memory</span></summary>

<div data-table-scroll style="overflow-x: auto" tabindex="0" role="region" aria-label="creation time, destruction time, and extra memory">

| Object contains            | Creation, ns | Destruction, ns | Extra memory, bytes |
| -------------------------- | -----------: | --------------: | ------------------: |
| No synchronization         |         15.7 |            17.5 |                   0 |
| `Atomic`                   |         15.7 |            17.0 |                   0 |
| `@MainActor` class         |         16.2 |            17.4 |                   0 |
| `Mutex`                    |         15.3 |            16.6 |                  16 |
| `os_unfair_lock`           |         22.4 |            24.6 |                  32 |
| `ManagedAtomic`            |         23.3 |            39.8 |                  32 |
| `OSAllocatedUnfairLock`    |         24.3 |            35.6 |                  32 |
| `pthread_mutex`            |         24.7 |            28.0 |                  80 |
| Actor                      |         20.7 |            22.3 |                  96 |
| `DispatchSemaphore`        |         23.8 |            65.9 |                  96 |
| `NSLock`                   |         26.8 |            36.2 |                 112 |
| Serial `DispatchQueue`     |        152.2 |            81.0 |                 160 |
| Concurrent `DispatchQueue` |        114.1 |            83.5 |                 176 |
| `pthread_rwlock`           |         25.3 |            28.7 |                 240 |
| `NSRecursiveLock`          |         31.4 |            34.9 |                 240 |

</div>

</details>

The same numbers as blocks. Drag the scene to turn it, and pick a mechanism to see where its bytes live.

<memory-blocks>
<p>Extra memory per object drawn as blocks. Atomic and a MainActor class add nothing. Mutex adds 16 bytes inside the object. OSAllocatedUnfairLock, os_unfair_lock, and ManagedAtomic add 32 bytes in a separate allocation, pthread_mutex 80, DispatchSemaphore 96, NSLock 112, NSRecursiveLock and pthread_rwlock 240. An actor adds 96 bytes inside the object. A serial queue adds 160 bytes and a concurrent queue 176, each in two separate allocations.</p>
</memory-blocks>

**`Mutex` adds 16 bytes to the object.** It's stored inside the object and needs no separate allocation. That's also why such an object is created as fast as one with no lock.

**The other locks need a separate allocation.** That makes two allocations per object instead of one. `OSAllocatedUnfairLock` adds 32 bytes, `NSLock` 112, and `NSRecursiveLock` and `pthread_rwlock` 240 each. `Mutex` and `OSAllocatedUnfairLock` were equal in access speed in the first experiment, but they aren't equal in creation cost.

**A queue takes three allocations per object and adds 160 bytes.** This is exactly the [Pocket Casts](https://github.com/Automattic/pocket-casts-ios/pull/5186) case from the feature flag section, where every flag created its own queue.

For 100,000 objects, that adds up to 1.6 MB with `Mutex`, 11 MB with `NSLock`, 16 MB with a serial queue, and 24 MB with `NSRecursiveLock`.

### iPhone 11 Pro Max

The memory numbers are the same on the older phone. The times are roughly double, but the ratios hold: creating an object takes 31.1 ns with a `Mutex`, 30.5 ns with no synchronization, and 318 ns with a serial queue.

### Takeaway

If every object needs a lock and there are many objects, use `Mutex`. Such an object is created as fast as one with no synchronization and takes only 16 more bytes.

Don't create a queue per object: the object takes seven to ten times as long to create and at least 160 more bytes.

For a single value, `Atomic` is enough, and it adds nothing to the object.

That was the last experiment. Now let's pull the conclusions together.

## Conclusion

At the start I asked whether there's a synchronization mechanism you can pick by default. There is, and it's `Mutex`. It was among the best in all eight experiments on the iPhone 15 Pro Max.

Other mechanisms beat it only under specific conditions: `Atomic` for a single value, the `.adaptiveSpin` flag for rare long calls. Neither a read-write lock nor a queue was faster than `Mutex` in any experiment.

At the same time, the choice of mechanism changes little. The cost of acquiring a free lock differs between mechanisms by nanoseconds, or by hundreds of nanoseconds for queues. Noticeable delays, in the microseconds and milliseconds, appeared in three cases: when threads competed for a lock continuously, when execution switched between the main thread and a background thread in a loop, and when a background thread held a lock for a long time.

The ruler below puts the article's numbers on one axis.

<time-ruler>
<p>The article's durations on one axis: an Atomic read 0.27 ns, a Mutex lock 1.86 ns, NSLock 6.36 ns, an actor call from a background task 52.6 ns, a flag read through queue.sync 203 ns, an image cache read 2.02 µs, a call from MainActor to an actor and back 4.89 µs, the p99 of a dictionary call under Mutex 19.1 µs, a frame at 120 Hz 8.33 ms, the main thread waiting for a Mutex held by a background thread 12.95 ms, and the same wait with DispatchSemaphore 65.63 ms.</p>
</time-ruler>

The lock is often only a small part of an optimization. Every app and every task is different, and the biggest speedup may be somewhere else entirely. My article [Why my Swift debouncer got 50× faster and what the Swift Runtime has to do with it](/posts/swift-debounce-runtime-investigation/) is one example.

### `Mutex` by default

The table collects the results of five experiments for the mechanisms that took part in almost all of them.

<div data-table-scroll style="overflow-x: auto" tabindex="0" role="region" aria-label="Results of five experiments for eight mechanisms">

| Mechanism               | Counter, ns | Dictionary, M ops/s | Dictionary, call p99, µs | 98% reads, M ops/s | Main-thread wait, ms | Extra memory, bytes |
| ----------------------- | ----------: | ------------------: | -----------------------: | -----------------: | -------------------: | ------------------: |
| `Mutex`                 |        1.86 |                1.06 |                     19.1 |               9.37 |                12.95 |                  16 |
| `OSAllocatedUnfairLock` |        1.86 |                1.08 |                     22.5 |               9.50 |                12.97 |                  32 |
| `os_unfair_lock`        |        1.85 |                1.04 |                     67.0 |               8.60 |                13.65 |                  32 |
| `pthread_mutex`         |        4.62 |                0.89 |                     51.7 |               9.29 |                12.96 |                  80 |
| `NSLock`                |        6.36 |                0.89 |                     51.8 |               8.05 |                12.96 |                 112 |
| `pthread_rwlock`        |        6.00 |          not tested |               not tested |               3.07 |                68.55 |                 240 |
| `DispatchSemaphore`     |        3.74 |                0.20 |                     47.3 |               1.05 |                65.63 |                  96 |
| Serial `DispatchQueue`  |       88.23 |                0.18 |                     64.1 |               0.45 |                13.86 |                 160 |

</div>

_iPhone 15 Pro Max. Counter: one thread. Dictionary: eight threads without pauses. 98% reads: six threads, groups of twenty records. Main-thread wait: a thread at `background` priority holds the lock._

**`Mutex`, `OSAllocatedUnfairLock`, and `os_unfair_lock` are the same lock.** On Apple platforms, `Mutex` [stores an `os_unfair_lock` inside itself](https://github.com/swiftlang/swift/blob/main/stdlib/public/Synchronization/Mutex/DarwinImpl.swift) and calls its functions directly. `OSAllocatedUnfairLock` is the same `os_unfair_lock` in separately allocated memory. So all three take the same time to acquire; they differ in where the lock is stored and how you acquire it.

**`Mutex` requires iOS 18.** If your app supports earlier versions, use `OSAllocatedUnfairLock`, which is available from iOS 16.

**Replacing a working `NSLock` with `Mutex` for speed is rarely worth it.** Uncontended, `NSLock` adds about 4.5 ns per acquisition, and under priority inversion the main thread waited as long with it as with `Mutex`. The difference shows up in two cases. The first is when threads hit the lock continuously: in the dictionary test, `NSLock` completed 15% fewer operations, and the call p99 rose from 19 to 52 µs. The second is when there are many locks: `NSLock` adds 112 bytes to an object, `Mutex` 16.

**A queue that protects state through `queue.sync` was among the slowest mechanisms in almost every experiment.** A counter increment through it takes 48 times as long as under `Mutex`, and a flag read a hundred times as long. In the dictionary test with eight threads, the serial queue completed almost six times fewer operations; at 98% reads, twenty times fewer. An object with its own queue takes ten times as long to create and 160 more bytes.

Replacing such a queue with a lock pays off mainly where accesses are continuous or where every object creates its own queue. If accesses are rare, the replacement won't make a noticeable difference.

### `Atomic` for a single value

**If one atomic operation is enough, `Atomic` is faster than a lock.** That covers reading a flag, replacing a value, or incrementing a counter. A flag read takes 0.32 ns versus 1.86 ns under `Mutex`. On the counter, `Atomic` matches `Mutex` with one thread and completes three times as many operations per second with two: 310 versus 102 million. And it doesn't add a single byte to the object.

**If a flag is already protected by a `Mutex`, replacing it with `Atomic` for speed is rarely worth it.** The difference is 1.5 ns per read: at 10,000 reads a second, that's 3 µs with `Atomic` and 19 µs with `Mutex`. The switch is justified when the flag is read far more often or when several threads constantly compete for the value.

Before iOS 18, you can use `ManagedAtomic` from the [swift-atomics](https://github.com/apple/swift-atomics) package instead of `Atomic`. A read with it takes 0.80 ns, and it adds 32 bytes to the object.

### Did the familiar advice hold up?

**"If you need performance, use `os_unfair_lock`."** The advice is essentially right, but `Mutex` is now the easier way to follow it. `Mutex` contains the same `os_unfair_lock`: acquiring it takes the same 1.86 ns, with no manual `lock()` and `unlock()` calls. `os_unfair_lock` didn't complete more operations per second than `Mutex` in either the dictionary test or the 98%-reads test. I found no reason to use it directly in new code.

**"If reads far outnumber writes, look at a read-write lock or a concurrent queue with a barrier."** For short in-memory operations, this advice didn't hold up. With 98% reads and six threads, `pthread_rwlock` completed a third as many operations per second as `Mutex`, and the concurrent queue about a sixth. Writes waited longer with them too: a write p99 of 21.8 and 29.6 µs versus 8.0 µs.

The most likely reason is the length of the operation. Acquiring a `pthread_rwlock` is more expensive in itself: a flag read under it takes 6.1 ns versus 1.86 ns under `Mutex`. For a short in-memory read, the gain from reading in parallel is smaller than that difference.

These mechanisms have two more drawbacks that have nothing to do with the share of reads. Under priority inversion, the main thread waited 68.6 ms for `pthread_rwlock` and 61.9 ms for a concurrent queue with writes via `sync(flags: .barrier)`, compared with 13 ms for `Mutex`. And `pthread_rwlock` adds 240 bytes to an object, fifteen times as much as `Mutex`.

So even with a high share of reads, start with `Mutex`. A read-write lock is worth testing if a read under the lock takes a long time. My tests had no such operations, so you'd need to measure the gain in your own code.

**"Actors are slow, use a lock."** This advice is half right. A call to an actor from a background task takes 52.6 ns, 28 times as long as acquiring a `Mutex`.

But we pay per call, not for the work done inside the actor. A hundred updates in one `await` cost 1.23 ns each instead of 58.1 ns. That's 47 times less, and close to the 0.69 ns of `Mutex`.

The most expensive thing in these tests wasn't the actor but the switch between the main thread and a background thread. The round trip takes about 5 µs, with or without an actor: 93 times as long as a call to an actor from a background task. And when the code is already running on the right actor, no switch is needed at all.

So here are my recommendations:

- Don't replace an actor with a lock just because a single call to it costs more. First look at where the calls come from and how much work each one does.
- Don't switch between the main thread and a background thread in a loop.
- Hand related operations to an actor in one call.
- Protect small state that has to be read synchronously with `Mutex`, even in asynchronous code.

**"Don't block the main thread."** The rule is right if you read it as a limit on how long a lock is held. When the main thread read the cache under `Mutex`, a read took about 2 µs. When a background thread ran a computation under a `Mutex`, the main thread waited 13 ms, which is already a hitch.

So do the computation before acquiring the lock, and keep only a short state update under it. And wherever the main thread might wait for a lock, avoid `DispatchSemaphore`, `pthread_rwlock`, and a concurrent queue with `sync(flags: .barrier)`: with those, it waited five times as long.

### Where to start

In most cases you can pick `Mutex` and stop thinking about which lock to use. Your time is better spent on what runs under the lock and how often the lock is acquired.

| Task                                                                      | Where to start                                                                                         |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| A short synchronous operation on shared state                             | `Mutex`; before iOS 18, `OSAllocatedUnfairLock`                                                        |
| A single value: a flag or a counter                                       | `Atomic`; before iOS 18, `ManagedAtomic`                                                               |
| Reads far outnumber writes                                                | `Mutex`. A read-write lock only if reads under the lock are long and measurement shows a gain          |
| The state is already in an actor or on `MainActor`                        | Leave it as is. Batch calls and don't switch between the main thread and a background thread in a loop |
| The main thread might wait for the lock                                   | `Mutex`, `OSAllocatedUnfairLock`, or `NSLock`, and only short work under the lock                      |
| A lock in each of thousands of objects                                    | `Mutex` or `Atomic`. Not a queue per object                                                            |
| Threads compete for the lock continuously and p99 matters                 | Test `OSAllocatedUnfairLock` with `.adaptiveSpin` on your own workload                                 |
| The code already has an `NSLock` or a serial queue, and accesses are rare | Don't replace it for speed                                                                             |

The [benchmark](https://github.com/ivan-magda/swift-synchronization-benchmarks) and the [raw results](https://github.com/ivan-magda/swift-synchronization-benchmarks/releases/tag/benchmark-results-2026-11-07) of every launch are public. You can run the experiments on your own device and compare your numbers with mine.

Thanks for reading! If your numbers come out different or you have questions, [open an issue](https://github.com/ivan-magda/swift-synchronization-benchmarks/issues) in the benchmark repository.
