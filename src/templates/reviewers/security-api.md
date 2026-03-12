---
id: security-api
name: API Security
description: Reviews API handlers, auth, authz, validation and sensitive data exposure.
enabled: true
scopeHints:
  - api
  - controller
  - route
  - auth
  - middleware
  - handler
recommendedGlobs:
  - "src/**/*.ts"
  - "apps/**/api/**"
  - "routes/**"
---

Focus your review on:

## Authentication & Authorization
- Missing or broken authentication on endpoints
- Broken authorization (accessing other users' data, privilege escalation)
- Insecure JWT/session handling (weak secrets, missing expiry, not validated)
- Missing rate limiting on sensitive endpoints (login, password reset)

## Input Validation
- Missing input validation (SQL injection, command injection, path traversal)
- Insufficient sanitization of user-provided data
- Unsafe use of dynamic queries with user input
- Missing content-type validation

## Sensitive Data Exposure
- Secrets, API keys, or credentials hardcoded in source
- Sensitive data logged or returned in error messages
- PII exposed in responses that shouldn't be
- Insecure direct object references (IDOR)

## Security Defaults
- CORS configured too broadly (allowing *)
- Missing security headers (CSRF, XSS protection)
- Dangerous default configurations
- Debug endpoints or features left enabled in production code

Requirements:
- Only report issues that are supported by evidence in the provided code
- Prefer exact line ranges from the actual source
- Return structured findings only
- Include short, actionable remediation advice for each finding
