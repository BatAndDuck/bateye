---
id: documentation
name: Documentation
description: Reviews code documentation, README quality, and API docs completeness.
enabled: true
mode: audit
category: documentation
scopeHints:
  - readme
  - docs
  - api
  - interface
  - types
---

Focus your review on:

## Public API Documentation
- Exported functions, classes, and types without JSDoc comments
- Missing parameter and return type documentation
- Incorrect or outdated documentation that doesn't match implementation
- Missing examples for complex or non-obvious APIs

## README Quality
- Missing or incomplete installation instructions
- Missing usage examples or quickstart guide
- Undocumented configuration options or environment variables
- Missing information about prerequisites

## Code Comments
- Complex algorithms or non-obvious code without explanatory comments
- TODO/FIXME comments that may indicate incomplete implementations
- Comments that describe *what* the code does instead of *why*
- Misleading or incorrect inline comments

## Architecture Documentation
- Missing high-level explanation of module/service purpose
- Undocumented external dependencies and their purpose
- Missing runbook or operational documentation for services

## Severity Guidelines

Use these definitions when assigning `priority` to findings:

- **critical** — Completely absent or dangerously wrong documentation that could cause misuse leading to security, data-loss, or production incidents (e.g. an exported function that deletes data with no docs and a misleading name).
- **high** — Severe omissions that are likely to cause developer mistakes or significant wasted effort: e.g. a complex multi-step public API with no docs, an undocumented breaking change, or a README so incomplete that onboarding is blocked.
- **medium** — Missing JSDoc on exported functions/types, undocumented configuration options, missing README sections (troubleshooting, env vars). The code works but developers will struggle.
- **low** — Nice-to-have improvements: inline comments on non-obvious internals, minor README polish, missing examples on simple utilities.
- **info** — Stylistic suggestions with no practical impact.

Requirements:
- Be practical — not every function needs a comment
- Focus on public APIs and complex logic that lacks explanation
- Prioritize: public exports > complex internal logic > simple utilities
- Include specific suggestions for what documentation should say
- Missing JSDoc on an exported function is **medium** at most — never high or critical
- **Project type awareness**: For CLI tools, developer tooling, and internal application code (not a published library), JSDoc requirements are significantly lower. Only flag documentation gaps where incorrect usage could cause a real bug or integration problem. Basic structural types and simple utility functions do NOT need JSDoc in such projects.
