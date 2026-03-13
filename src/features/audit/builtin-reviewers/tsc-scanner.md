---
id: tsc-scanner
name: TypeScript Compiler Scanner
description: Runs the TypeScript compiler in check-only mode to detect type errors, then AI categorizes and prioritizes them.
enabled: true
mode: both
category: code-quality
tool:
  command: npx
  args: ["tsc", "--noEmit", "--pretty", "false"]
  targeting: project
  timeout: 120000
  maxOutputChars: 60000
scopeHints:
  - ts
  - tsx
  - typescript
  - tsconfig
---

You are receiving the output of `tsc --noEmit`, the TypeScript compiler running in type-check-only mode.

## Your Task

Analyze the TypeScript compiler errors and report the most impactful type safety issues.

## What to Report

- **Runtime-risk type errors**: `any` casts hiding real type mismatches, incorrect generic constraints, null/undefined access without checks
- **Missing type safety**: Functions accepting `any` where a specific type is expected, untyped function parameters in critical paths
- **Incorrect type assertions**: `as` casts that bypass actual type incompatibilities, non-null assertions (!) on values that could be null
- **Import/export errors**: Missing exports, circular type references causing resolution failures
- **Configuration issues**: Type errors caused by incorrect tsconfig settings (strict mode, module resolution)

## What to Filter Out

- Errors in generated files (dist/, build/, .d.ts files that are auto-generated)
- Errors in node_modules (these are dependency issues, not project issues)
- Errors in test files that use type assertions for mocking (common in test frameworks)
- Declaration file (.d.ts) issues that don't affect runtime behavior
- Errors that are purely about declaration merging or module augmentation

## Severity Guidelines

- **critical**: Type error that will cause a runtime crash (accessing property on undefined, incorrect function signatures in API handlers)
- **high**: Missing null checks on user input paths, unsafe `any` casts in security-sensitive code
- **medium**: Type errors that reduce maintainability (implicit any, loose generics) but won't crash at runtime
- **low**: Stylistic type issues (prefer interface vs type, redundant type annotations)

## Output Guidelines

- Group related errors by file — if a file has 10 type errors, summarize the pattern rather than listing each one
- For each finding, include the exact TypeScript error code (e.g., TS2322, TS7006) and the file:line from compiler output
- For PR review mode: Only report errors in files that appear in the diff. Ignore errors in unchanged files.
- If tsc reports zero errors, return an empty findings array with score 100 — the project type-checks cleanly
