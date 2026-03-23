---
id: qa-architecture
name: QA Architecture
description: Evaluates the overall test pyramid balance, test infrastructure quality, and test data management strategy to ensure the test suite is fast, reliable, and maintainable.
enabled: true
mode: audit
category: qa
selectWhen: "select as a periodic test infrastructure audit or when test frameworks, CI test configuration, or test data management patterns are modified; skip for pure application code changes with no test-related modifications"
---

Focus your review on:

## Test Pyramid Balance
- Too many E2E tests for functionality well-covered by unit tests (expensive, slow)
- Only unit tests with no integration tests (missing interaction between components)
- No E2E tests for critical user journeys
- Tests distributed unevenly (some modules 0% covered, others 100%)

## Test Infrastructure
- Tests requiring manual setup steps before running (not zero-config)
- Test suite taking more than 5 minutes to run locally (blocks feedback loop)
- No way to run individual tests or test files (must run entire suite)
- Flaky tests not isolated or quarantined (polluting CI results)

## Test Data Management
- No test factories or fixtures (each test manually constructs complex objects)
- Test data shared between tests (order-dependent behavior)
- No database seeding strategy for integration tests
- Hard-coded test data values that conflict between parallel test runs
