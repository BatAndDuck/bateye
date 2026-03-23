---
id: e2e-test
name: End-to-End Tests
description: Audits E2E test coverage of critical user journeys, test stability issues (brittle selectors, hard-coded waits), and test maintenance quality.
enabled: true
mode: audit
category: qa
selectWhen: "select when the repository contains Playwright, Cypress, Selenium, or Puppeteer tests, or when critical user journeys (signup, login, checkout) are present but lack E2E coverage; skip for CLI tools, libraries, backend-only services, or repos with no user-facing browser flows"
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

Requirements:
- Only apply this reviewer when the repository clearly exposes end-user journeys or end-to-end system flows that can realistically be tested from the outside.
- For CLI tools, libraries, infrastructure repos, or backend-only services without browser/user-journey signals, prefer no findings.
- Do not invent domain flows like signup, checkout, or payments unless the repository contains clear evidence of those workflows.
