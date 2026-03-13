---
id: complexity
name: Complexity
description: Detects excessive cyclomatic and cognitive complexity, over-engineering, and code patterns that make logic difficult to understand, test, or safely modify.
enabled: true
mode: both
category: code-quality
scopeHints:
  - service
  - controller
  - handler
  - util
  - helper
  - component
  - function
  - class
recommendedGlobs:
  - "**/*.ts"
  - "**/*.js"
  - "**/*.py"
  - "**/*.go"
  - "**/*.java"
---

Focus your review on:

## Cyclomatic Complexity
- Functions with more than 10 conditional branches (if/else/switch/ternary chains) — each additional branch adds a test case and a mental model path
- Deeply nested conditionals exceeding 3 levels of indentation — deeply nested logic is hard to reason about and its edge cases are easy to miss
- Long boolean expressions combining many conditions without extracting intermediate named variables to explain what the combined condition means
- Switch statements with many cases that all perform similar logic — a dispatch table, registry, or polymorphism would reduce the number of branches
- Ternary expressions chained or nested more than one level deep — use explicit if/else when there are more than two outcomes
- Guard clauses not used — positive case first, then handle exceptional cases early with early returns instead of wrapping the positive path in a deeply nested if

## Cognitive Complexity
- Functions exceeding 50 lines of code — strong candidate for extraction into smaller, named functions with clear single responsibilities
- Functions that clearly do more than one thing — the function body has natural "phases" that could each be extracted as a named step
- Variables reused for different purposes at different points in a function — reassigning the same variable to hold different semantic values forces readers to track current meaning through the whole function
- Functions that mix levels of abstraction — high-level orchestration steps interleaved with low-level implementation details in the same function body
- Early returns mixed with complex nesting in ways that create multiple mental execution models the reader must hold simultaneously
- Long parameter lists (more than 4 parameters) without a parameter object — each caller must know and supply all parameters in the correct order

## Over-Engineering
- Abstract factory patterns implemented for a single concrete type that will realistically never have a second implementation — the factory adds indirection with no benefit
- Strategy pattern with exactly one strategy — a direct function call or simple conditional would be clearer and equally maintainable
- Builder pattern applied to objects with three or fewer fields — a constructor or object literal is simpler
- Event or message bus used for intra-module communication within a single process when direct function calls would be more explicit and easier to follow
- Repository or service interfaces with exactly one implementation and no realistic prospect of a second — the interface adds a layer of indirection with no benefit in this context
- Heavily parameterized or generic classes designed to handle hypothetical future variation that doesn't exist — simplify to the concrete case
- Unnecessary intermediate transformation or mapping steps that convert data between nearly identical shapes without meaningful semantic change
