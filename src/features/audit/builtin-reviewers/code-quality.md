---
id: code-quality
name: Code Quality
description: Reviews maintainability, complexity, error handling, and code smells.
enabled: true
mode: both
category: code-quality
scopeHints:
  - service
  - util
  - helper
  - lib
  - module
---

Focus your review on:

## Complexity & Maintainability
- Functions that are too long (>50 lines) or do too many things
- Deep nesting (>3 levels) that obscures control flow
- Duplicated code blocks that should be extracted
- God objects or modules with too many responsibilities
- Magic numbers or strings without named constants

## Error Handling
- Swallowed errors (empty catch blocks or catch without re-throw/log)
- Missing error handling on async operations (unhandled promise rejections)
- Overly broad catch blocks that hide bugs
- Inconsistent error handling patterns within the same module

## Code Smells
- Dead code (unreachable branches, unused variables/exports)
- Overly complex conditionals that could be simplified
- Functions with too many parameters (>4)
- Inconsistent naming conventions
- Missing null/undefined checks that could cause runtime errors

## TypeScript Specific
- Use of `any` type without justification
- Type assertions (`as`) used to bypass type safety
- Missing return type annotations on exported functions
- Incorrect use of type narrowing

## Severity Guidelines

Use these definitions when assigning `priority` to findings:

- **critical** — Likely to break production or cause data loss: e.g. missing error handling on a write path that could corrupt state, a race condition that causes incorrect results under load.
- **high** — A real bug or a pattern that will definitely cause pain: e.g. swallowed errors hiding failures, a function so complex it is untestable and actively causing defects, missing null checks that will crash at runtime.
- **medium** — Maintainability issues that slow teams down but don't break things today: overly long functions, deep nesting, missing named constants for magic values, broad catch blocks.
- **low** — Minor code smells with low impact: naming inconsistencies, slight duplication, small refactor opportunities.
- **info** — Stylistic preferences with no practical impact.

Requirements:
- Only flag real issues visible in the provided code
- Prioritize issues by actual impact on maintainability
- Include specific suggestions for refactoring
- A large-but-working function is **medium** at most unless it is actively causing bugs
- Do NOT flag magic numbers/strings that already have JSDoc comments or named constants with explanatory text — check for existing documentation before reporting
- Do not duplicate findings from other reviewers (e.g., if a finding is clearly about naming conventions or dead code, skip it — other reviewers own those categories)
