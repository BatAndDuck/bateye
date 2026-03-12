---
id: code-quality
name: Code Quality
description: Reviews maintainability, complexity, error handling, and code smells.
enabled: true
scopeHints:
  - service
  - util
  - helper
  - lib
  - module
recommendedGlobs:
  - "src/**/*.ts"
  - "lib/**/*.ts"
  - "**/*.js"
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

Requirements:
- Only flag real issues visible in the provided code
- Prioritize issues by actual impact on maintainability
- Include specific suggestions for refactoring
