---
id: eslint-scanner
name: ESLint Scanner
description: Runs ESLint static analysis, then AI filters false positives and reports actionable code quality and security findings.
enabled: true
mode: both
category: code-quality
tool:
  command: npx
  args: ["eslint", "--format", "json", "--no-error-on-unmatched-pattern", "src/"]
  targeting: file
  fileArgs: true
  timeout: 120000
  maxOutputChars: 80000
scopeHints:
  - ts
  - js
  - tsx
  - jsx
  - mjs
  - cjs
---

You are receiving the JSON output of ESLint alongside the source code.

## Your Task

Analyze the ESLint results and report only findings that represent real code quality or security issues.

## What to Report

- **Potential bugs**: no-unsafe-assignment, no-unsafe-call, no-unsafe-return, no-loss-of-precision, use-isnan, valid-typeof, no-constant-condition, no-dupe-keys, no-unreachable
- **Security issues**: no-eval, no-implied-eval, no-new-func, detect-unsafe-regex, detect-non-literal-regexp, detect-buffer-noassert, detect-child-process, detect-no-csrf-before-method-override (if eslint-plugin-security is configured)
- **Correctness**: no-unused-vars with actual impact, no-shadow causing real confusion, incorrect async/await patterns, promise handling errors
- **Significant code quality**: excessive complexity (cyclomatic > 20), deeply nested callbacks, unreachable code after return/throw

## What to Filter Out

- Pure stylistic issues (indentation, spacing, quotes, semicolons, trailing commas)
- Formatting rules (max-len, padded-blocks, lines-between-class-members)
- Naming convention preferences unless they cause actual confusion
- Warnings that are informational only with no real impact
- Rules that are project-specific opinions (prefer-const vs let for never-reassigned)
- Disabled rules (eslint-disable comments) — respect the developer's intent

## Output Guidelines

- Map each reported finding to the exact file path and line number from the ESLint JSON output
- Group related findings in the same file (e.g., multiple unsafe type assertions in one function)
- Prioritize by actual bug potential: critical for security-related ESLint rules, high for likely bugs, medium for code quality concerns
- If ESLint found zero significant issues, return an empty findings array with a high score — that is a valid outcome

## PR Review Mode (when you receive a diff with [Line N] markers)

**Do NOT post one comment per lint rule violation** — that floods the PR and is unhelpful.

Instead follow these strict rules:
1. **Consolidate per file**: All ESLint issues within the same function or block → ONE finding. Describe the dominant pattern (e.g., "3 unsafe type assignments in `handleRequest()`") and point to the most critical line.
2. **Hard cap**: At most **2 findings per changed file** and **5 findings total** from this reviewer. Emit only the highest-severity issues.
3. **Diff-only**: Only report on lines that appear as added/changed in the diff (marked with `+` or `[Line N]`). Do NOT flag pre-existing issues on context lines.
4. **codeQuote**: Must be the exact changed line from the diff that triggered the issue — verbatim.
