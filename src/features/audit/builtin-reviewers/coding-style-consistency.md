---
id: coding-style-consistency
name: Coding Style Consistency
description: Identifies naming convention inconsistencies, mixed code patterns, and TypeScript-specific style drift that signal a lack of shared standards across the codebase.
enabled: true
mode: both
category: code-quality
scopeHints:
  - style
  - naming
  - convention
  - format
  - lint
  - pattern
  - standard
---

Focus your review on:

## Naming Conventions
- Mixed camelCase and snake_case for the same category of identifier (e.g., function names or variable names) in the same module or codebase
- Inconsistent capitalization of acronyms: `userId` in one file, `UserID` in another, `user_id` in a third, when the codebase should pick one convention and apply it uniformly
- Inconsistent use of singular versus plural for collection variable names: `const users = getUsers()` is clear, but `const user = getUsers()` is misleading
- Constants not consistently UPPER_SNAKE_CASE or consistently PascalCase — mixing both within the same module creates ambiguity about which values are constants
- Boolean function names that don't follow a consistent predicate convention: some start with `is`, `has`, `can`, `should`; others use bare adjectives or nouns
- File naming conventions inconsistently applied: some service files are `UserService.ts`, others are `user.service.ts`, others are `user-service.ts` in the same directory

## Code Patterns
- Inconsistent use of `async/await` versus Promise `.then()/.catch()` chains in the same module for functionally identical async operations — one style should be chosen and applied uniformly
- Mixed use of functional array methods (`.map`, `.filter`, `.reduce`) and imperative `for` loops for similar operations on the same types of data in the same codebase
- Inconsistent import ordering across files — some files group external modules, then internal modules, then types; others mix all three without a consistent order
- Mixed use of arrow functions and traditional `function` declarations for the same purpose (callbacks, utility functions) when the codebase should apply one style consistently
- Inconsistent object destructuring usage: some code destructures at the function parameter level, other similar functions accept the whole object and access properties inline
- Mixed use of template literals and string concatenation for similar string construction throughout the codebase
- Inconsistent use of optional chaining (`?.`) and manual null checks for the same pattern of potentially-null access

## TypeScript Specific
- Inconsistent use of `type` versus `interface` for similar constructs — if `interface` is used for object shapes, using `type` for a similar object shape in the same module is inconsistent
- Mixed explicit and inferred return types on exported functions — if exported functions in the same module have explicit return types, all of them should
- Inconsistent use of `readonly` on similar data structures — if immutable DTOs use `readonly` fields in some places, they should use it everywhere for the same category of type
- Inconsistent use of `as const` versus typed constants for similar enum-like patterns
- Mixed use of `enum` and union literal types for the same category of discriminated values within the same codebase
- Inconsistent generic type parameter naming: some use single letters (`T`, `K`, `V`), others use descriptive names (`TEntity`, `TKey`) — one convention should apply throughout
- Inconsistent null representation: some code uses `null`, some uses `undefined`, some uses both interchangeably for the concept of "no value" in the same domain
