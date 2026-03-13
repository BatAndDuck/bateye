---
id: concurrency
name: Concurrency & Thread Safety
description: Identifies race conditions, async bottlenecks, and resource contention issues in concurrent and parallel code that can cause data corruption or degraded throughput.
enabled: true
mode: both
category: performance
scopeHints:
  - async
  - promise
  - thread
  - worker
  - concurrent
  - parallel
  - mutex
  - lock
  - race
  - queue
  - pool
recommendedGlobs:
  - "**/*.ts"
  - "**/*.js"
  - "**/*.py"
  - "**/*.go"
  - "**/*.java"
  - "**/*.rs"
---

Focus your review on:

## Race Conditions
- Shared mutable state accessed from concurrent async operations without synchronization
- Check-then-act patterns without atomic guarantees (read a value, then update based on it without locking)
- Event listeners that modify shared state when multiple events fire simultaneously
- Multiple async operations that can interleave on the same resource

## Async Bottlenecks
- Sequential await chains where Promise.all() would parallelize independent operations
- Sequential database queries that could be batched or run in parallel
- Blocking the event loop with synchronous CPU-intensive operations (should use worker threads)
- Recursive async functions without concurrency limits (can exhaust connection pool)

## Resource Contention
- Database operations without appropriate transaction isolation levels
- Missing optimistic locking on concurrent update patterns (lost updates)
- Mutex/lock held too long (blocking other operations unnecessarily)
- Connection pools exhausted by long-running operations blocking short ones
