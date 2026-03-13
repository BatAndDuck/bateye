---
id: test-coverage
name: Test Coverage
description: Identifies critical paths, edge cases, and whole modules lacking test coverage, particularly in business logic, error handling, and authentication/authorization code.
enabled: true
mode: audit
category: qa
scopeHints:
  - test
  - spec
  - coverage
  - unit
  - integration
  - jest
  - pytest
  - vitest
  - mocha
---

Focus your review on:

## Critical Path Coverage
- Core business logic functions with no corresponding tests
- Error handling paths (catch blocks, error returns) not covered by tests
- Public API endpoints with no integration tests
- Authentication and authorization logic with no tests

## Edge Case Coverage
- Boundary conditions not tested (empty input, max size, zero, negative)
- Concurrency scenarios not tested (what happens with simultaneous requests)
- Failure scenarios not tested (what happens when dependencies fail)
- Happy path tested but all error paths untested

## Test Gaps
- New functions added without any tests
- Complex conditional logic branches not all covered
- Data transformation functions lacking tests for various input shapes
- Configuration validation logic not tested
