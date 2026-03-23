---
id: security-api
name: API Security
description: Reviews API handlers, auth, authz, validation and sensitive data exposure.
enabled: true
mode: both
category: security
selectWhen: "almost always - select whenever there are API endpoints, auth or authz logic, input handling, credential management, or data exposure paths; skip only for pure documentation, unit tests that mock everything, or purely internal refactors with no user-facing surface"
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

## Severity Guidelines

Use these definitions when assigning `priority` to findings:

- **critical** - Directly exploitable in production: hardcoded secrets, authentication bypass, SQL/command injection with user input, IDOR exposing other users' data, missing auth on sensitive endpoints.
- **high** - Serious security standard violation that is likely to be exploited or has significant legal/compliance impact: overly broad CORS on authenticated APIs, missing rate limiting on login/reset, sensitive PII in logs or error responses.
- **medium** - Weakens the security posture but requires additional conditions to exploit: missing CSRF protection on low-risk endpoints, debug routes that expose non-sensitive info, weak but not absent validation.
- **low** - Defence-in-depth improvements: adding security headers that aren't strictly required, tightening already-adequate validation.
- **info** - Best-practice reminders with negligible real-world risk in the current context.

Requirements:
- Only report issues that are supported by evidence in the provided code
- Prefer exact line ranges from the actual source
- Return structured findings only
- Include short, actionable remediation advice for each finding
