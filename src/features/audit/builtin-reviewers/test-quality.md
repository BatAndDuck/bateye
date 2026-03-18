---
id: test-quality
name: Test Quality
description: Reviews tests for flakiness, weak assertions, mock quality problems, and poor test design that gives false confidence in coverage without actually catching bugs.
enabled: true
mode: both
category: qa
selectWhen: "select when the PR adds, modifies, or removes tests, or when new features/fixes are added without corresponding tests; skip for pure documentation or infrastructure changes with no testable logic"
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

## Requirements
- Before flagging environment variable cleanup as a vulnerability, verify that the test does NOT already save the original value before modifying it. A test that saves `const original = process.env.X` before setting `process.env.X = ...` and restores it in `finally` is correctly implemented — do NOT flag it.
- Only flag environment variable issues when the test genuinely fails to restore the original value (i.e., it sets process.env.X without first saving the old value).
- Do not flag findings with confidence below 0.7.
