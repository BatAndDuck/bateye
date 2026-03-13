---
id: test-quality
name: Test Quality
description: Reviews tests for flakiness, weak assertions, mock quality problems, and poor test design that gives false confidence in coverage without actually catching bugs.
enabled: true
mode: both
category: qa
scopeHints:
  - test
  - spec
  - jest
  - mocha
  - pytest
  - vitest
  - describe
  - it
  - expect
  - assert
  - mock
  - stub
recommendedGlobs:
  - "**/*.test.ts"
  - "**/*.spec.ts"
  - "**/*.test.js"
  - "**/*.spec.js"
  - "**/tests/**"
  - "**/__tests__/**"
---

Focus your review on:

## Flaky Tests
- Tests depending on wall clock time (new Date() comparisons that can fail if run slowly)
- Tests with race conditions (multiple async operations without proper waiting)
- Tests sharing mutable state between test cases (order-dependent tests)
- Tests relying on external services without proper mocking/stubbing

## Weak Assertions
- Assertions that only check truthy/falsy instead of exact values
- Missing assertions on error cases (only happy path tested, catch block never tested)
- Tests that assert the mock was called but not what it was called with
- Snapshot tests that are too large (entire component HTML) making changes impossible to review

## Mock Quality
- Mocking too broadly (mocking entire modules when only one function needs mocking)
- Mocks that don't match the real implementation's interface (mock drift)
- Tests that mock what they're testing (mocking the function under test)
- Missing restoration of mocks between tests (spy pollution across test cases)

## Test Design
- Multiple assertions in a single test case testing unrelated behaviors
- Test description doesn't match what the test actually verifies
- Setup code duplicated across many tests instead of using beforeEach/fixtures
- Tests so tightly coupled to implementation they break on any refactor
