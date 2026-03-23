---
id: algorithmic-complexity
name: Algorithmic Complexity
description: Identifies O(N²) and worse time complexity patterns, unnecessary iteration, data structure misuse, and unbounded operations that will degrade under load.
enabled: true
mode: both
category: performance
selectWhen: "select when code contains loops, sorting, searching, data processing, or any operation on collections that could degrade at scale; skip for simple CRUD, configuration, or documentation-only changes"
---

Focus your review on:

## O(N²) and Worse Patterns
- Nested loops over unbounded collections (outer.forEach inner.find - O(N²) search)
- Array.includes() or Array.find() inside a loop over unbounded data (should use Set/Map for O(1) lookups)
- Sorting inside a loop when you could sort once outside
- Recursive functions without memoization on overlapping subproblems

## Unnecessary Iteration
- Multiple sequential .filter().map().reduce() passes that could be a single pass
- Re-computing derived values on every iteration that don't change (should be hoisted)
- Full collection scans when indexed access or early-exit would suffice
- Cloning large arrays/objects unnecessarily inside tight loops

## Data Structure Misuse
- Using Array.indexOf() / Array.includes() for frequent membership tests (use Set)
- Using arrays for keyed lookups where Map/object would give O(1) access
- Building concatenated strings in loops instead of array join
- Spreading large arrays (...array) when push/concat is more efficient

## Unbounded Operations
- Operations without pagination that will degrade as data grows
- Batch processing with no chunk size limit (loads entire dataset into memory)
- Regular expressions with catastrophic backtracking potential (ReDoS risk)
