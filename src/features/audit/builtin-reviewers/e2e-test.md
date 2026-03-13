---
id: e2e-test
name: End-to-End Tests
description: Audits E2E test coverage of critical user journeys, test stability issues (brittle selectors, hard-coded waits), and test maintenance quality.
enabled: true
mode: audit
category: qa
scopeHints:
  - e2e
  - playwright
  - cypress
  - selenium
  - puppeteer
  - integration
  - journey
  - flow
  - user
  - scenario
---

Focus your review on:

## Critical Journey Coverage
- Core user journeys without E2E tests (signup, login, checkout, core feature workflow)
- Authentication flows not covered by E2E tests
- Payment or other high-value flows relying only on unit tests
- Critical admin operations not tested end-to-end

## Test Stability
- E2E tests using brittle selectors (XPath, CSS classes that change, positional selectors)
- Hard-coded waits (sleep/setTimeout) instead of waiting for elements/network
- Tests that assume a specific database state without proper seeding/cleanup
- Tests that depend on external services without proper mocking at the network layer

## Maintenance
- E2E tests that mirror unit tests (same coverage, higher cost)
- Missing page object model or similar abstraction (test logic mixed with selectors)
- Tests not cleaned up after running (leaving test data in the database)
