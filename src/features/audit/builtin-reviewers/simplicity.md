---
id: simplicity
name: Simplicity
description: Identifies over-engineering, accidental complexity, and premature optimization that make code harder to understand, maintain, and debug without meaningful benefit.
enabled: true
mode: both
category: devex
scopeHints:
  - util
  - helper
  - service
  - config
  - middleware
  - factory
  - provider
  - manager
  - abstraction
recommendedGlobs:
  - "**/*.ts"
  - "**/*.js"
  - "**/*.py"
  - "**/*.go"
  - "**/*.java"
---

Focus your review on:

## Over-Engineering
- Multiple layers of abstraction for simple operations (repository → service → usecase → facade → controller for a simple CRUD)
- Custom implementations of things available in standard library or well-established packages
- Generic frameworks built for hypothetical future use cases with only one current user
- Configuration objects with 20+ fields where 3 would suffice

## Accidental Complexity
- Code that requires understanding many files to trace a simple operation
- Indirection that makes debugging harder (abstract factories, dynamic dispatch for simple cases)
- Heavy framework ceremony for simple tasks (full DI container for a 3-file CLI)
- Async patterns where synchronous would be simpler and performance is not a concern

## Premature Optimization
- Complex caching logic for data that isn't actually expensive to compute
- Connection pooling for operations that run infrequently
- Batch processing infrastructure for datasets of dozens of items
- Micro-optimizations that reduce readability without measurable performance benefit
