---
id: clean-code
name: Clean Code
description: Reviews code for naming clarity, function design, code readability, and consistency issues that reduce maintainability and increase onboarding friction.
enabled: true
mode: both
category: code-quality
scopeHints:
  - service
  - util
  - helper
  - component
  - handler
  - model
  - class
  - function
recommendedGlobs:
  - "**/*.ts"
  - "**/*.js"
  - "**/*.py"
  - "**/*.go"
  - "**/*.java"
  - "**/*.rb"
---

Focus your review on:

## Naming
- Variables or functions with names that convey no intent: `d`, `tmp`, `data`, `stuff`, `process`, `item`, `val`, `res` — names should communicate the purpose and domain meaning
- Boolean variables not named as predicates — `isValid`, `hasPermission`, `shouldRetry`, `canEdit` communicate intent clearly; `valid`, `permission`, `retry` do not
- Functions named with vague verbs that don't identify what is being acted on: `handle`, `process`, `manage`, `do`, `run` — the noun should always accompany the verb
- Abbreviations that are not universally understood within the domain — `usr`, `cfg`, `req`, `mgr`, `svc` are only clear to those already familiar with the code
- Inconsistent naming for the same concept across the codebase — `userId` in one file, `user_id` in another, `uid` in a third all refer to the same thing
- Collection variables named with singular nouns (`const user = getUsers()`) or singular-plural inversions
- Negated boolean variable names that require double negatives when used: `isNotDisabled` forces readers to evaluate `if (!isNotDisabled)` mentally

## Function Design
- Functions with boolean flag parameters that alter behavior — `processOrder(order, true)` should be two clearly named functions: `processNewOrder` and `processReturnOrder`
- Output parameters: receiving an object and mutating it instead of returning a new value — this hides side effects and makes the function unpredictable to callers
- Side effects in functions named as queries — `getUser()` that also logs the access, updates a last-seen timestamp, or modifies state violates the command-query separation principle
- Default parameter values that silently hide required data — when a parameter has no meaningful default, it should be required, not given an arbitrary default
- Functions that return different types depending on a condition — returning either an object or `null`, or either a string or a number, forces all callers to handle multiple types
- Accessing contextual data from global or module scope inside a function that should receive it as a parameter — hidden inputs make the function hard to test and understand in isolation

## Code Clarity
- Negative conditionals that require mental inversion: `if (!isNotValid)` should be `if (isValid)` — eliminate double negatives wherever possible
- Magic numbers embedded directly in logic without named constants — `if (retries > 3)` and `setTimeout(fn, 30000)` should use named constants explaining what 3 and 30000 represent
- Comments that explain *what* the code does (redundant with the code itself) instead of explaining *why* a particular approach was chosen or *why* a non-obvious constraint exists
- Commented-out code blocks without any explanation of why they were disabled — should be deleted; git history preserves removed code
- Long function bodies with no visual structure or intermediate variable names that would break the logic into readable named steps
- Complex conditional expressions evaluated inline rather than extracted to a boolean variable with an explanatory name

## Consistency
- Mixed coding styles within the same file or module — some functions use early returns, others use nested ifs; some use `const`, others use `let` for immutable values
- Inconsistent error handling patterns across similar functions in the same module: some throw exceptions, some return `null`, some return an error object
- Inconsistent naming conventions within the same file: camelCase identifiers alongside snake_case identifiers for the same category of symbol
- Inconsistent use of `async/await` versus `.then()/.catch()` chains in the same codebase, making it harder to reason about the async flow
- Inconsistent import grouping and ordering across files — no consistent order for external libraries, internal modules, and type imports
- Similar operations implemented differently in different parts of the codebase when the same pattern should apply uniformly
