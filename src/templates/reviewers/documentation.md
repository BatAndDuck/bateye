---
id: documentation
name: Documentation
description: Reviews code documentation, README quality, and API docs completeness.
enabled: true
scopeHints:
  - readme
  - docs
  - api
  - interface
  - types
recommendedGlobs:
  - "**/*.md"
  - "src/**/*.ts"
  - "docs/**"
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

Requirements:
- ONLY flag documentation issues for code that is directly visible in the diff
- Every finding must reference the specific code from the diff that lacks documentation
- Do not suggest adding documentation for code you cannot see in the diff
- Be practical — not every function needs a comment
- Focus on public APIs and complex logic that lacks explanation
- Prioritize: public exports > complex internal logic > simple utilities
- Include specific suggestions for what documentation should say
- If documentation is adequate, report zero findings — do not pad the review
