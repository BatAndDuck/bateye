---
id: log-reviewer
name: Logging Quality
description: Reviews log level appropriateness, log content quality, PII and secret exposure in logs, and whether structured logging conventions are followed consistently.
enabled: true
mode: both
category: sre
scopeHints:
  - log
  - logger
  - logging
  - console
  - winston
  - pino
  - bunyan
  - logrus
  - zap
  - slog
  - error
  - warning
  - info
recommendedGlobs:
  - "**/*.ts"
  - "**/*.js"
  - "**/*.py"
  - "**/*.go"
  - "**/*.java"
---

Focus your review on:

## Log Level Appropriateness
- Errors logged at info or debug level (should be error or warn)
- Verbose debug logs left enabled that will run in production
- Business-critical events (order placed, payment processed) not logged at all
- Every function entry/exit logged at info level (too noisy for production)

## Log Content Quality
- Error logs without the stack trace (can't debug root cause)
- Logs without correlation/request ID (can't trace a single request through multiple logs)
- Vague log messages that don't identify what failed or where ("Error occurred", "Something went wrong")
- Missing context in logs (which user, which resource, which operation)

## PII & Security in Logs
- Passwords, tokens, API keys logged in plaintext
- Personal data (email, phone, SSN) logged without masking
- Full request/response bodies logged including sensitive fields
- Authentication tokens included in error logs

## Structured Logging
- String concatenation used for log messages instead of structured key-value fields
- Inconsistent field names across log statements (userId vs user_id vs uid)
- Missing severity/level field in log output
