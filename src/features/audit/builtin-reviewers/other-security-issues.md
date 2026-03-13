---
id: other-security-issues
name: General Security Issues
description: Reviews security issues not covered by specialized security reviewers (secrets, OWASP, input-validation, authorization, network-policy).
enabled: true
mode: both
category: security
scopeHints:
  - security
  - crypto
  - hash
  - encrypt
  - random
  - session
  - cookie
  - token
  - jwt
  - config
---

Focus your review on:

## Weak Cryptography
- Use of MD5 or SHA-1 for password hashing — these are not suitable for passwords; use bcrypt, argon2, or scrypt
- SHA-256 used for password hashing without a salt and iteration count (raw SHA-256 is too fast for password storage)
- AES encryption using ECB mode (`AES/ECB/PKCS5Padding`) — ECB is deterministic and reveals patterns in plaintext
- Weak key sizes: RSA keys shorter than 2048 bits, AES keys shorter than 128 bits, ECDSA curves weaker than P-256
- `Math.random()` used to generate security-sensitive values (tokens, nonces, OTP codes, session IDs) — use `crypto.getRandomValues()` or `crypto.randomBytes()`
- Hardcoded or static IV/nonce values reused across encryptions — IVs must be unique and unpredictable per encryption operation
- Outdated hash algorithms in HMAC construction (e.g., `HMAC-MD5`, `HMAC-SHA1`) for integrity-sensitive signatures

## Cookie Security
- Cookies that carry session identifiers or authentication tokens missing the `HttpOnly` flag — readable by JavaScript, enabling XSS token theft
- Session or auth cookies missing the `Secure` flag — transmitted over plaintext HTTP in mixed-content or HTTP contexts
- Cookies missing `SameSite` attribute (`Strict` or `Lax`) — increases CSRF risk, especially for session cookies
- Cookie `Domain` attribute set too broadly (e.g., `.example.com` when the cookie should be scoped to `app.example.com`)
- Session tokens stored in `localStorage` rather than `HttpOnly` cookies — exposed to XSS

## Session Management
- Session fixation: session ID not regenerated after successful authentication (`req.session.regenerate()` not called on login)
- Session tokens that do not expire or have an excessively long absolute expiration (days/weeks for sensitive sessions)
- Missing idle/inactivity timeout on sessions for sensitive operations
- Session data containing sensitive information (full credit card numbers, plaintext passwords, PII) that should not be stored server-side in the session

## Timing Attacks
- Secret comparison performed with `===` or `==` operator instead of a constant-time comparison function (`crypto.timingSafeEqual()`, `hmac.compare_digest()`, `subtle.timingSafeEqual()`)
- Password reset token, TOTP code, or API key comparisons that can leak timing information
- Early return on the first mismatched character of a secret comparison loop

## Dangerous JavaScript Patterns
- `eval(expression)` called with any dynamically constructed string that is not a compile-time constant
- `new Function(string)` used for dynamic code execution — equivalent security risk to eval
- `setTimeout(string, delay)` or `setInterval(string, delay)` with a string argument — these evaluate the string as code
- Prototype pollution via `Object.assign({}, userInput)` or recursive merge functions that allow `__proto__` or `constructor.prototype` manipulation
- `vm.runInNewContext()` or `vm.runInThisContext()` used with untrusted input — Node.js `vm` module does not provide a security sandbox

## XML and Serialization
- XML parsed with an XML library that has external entity processing enabled and the input comes from untrusted sources (XXE — XML External Entity injection)
- YAML parsed with `yaml.load()` instead of `yaml.safe_load()` / `yaml.load(data, Loader=yaml.SafeLoader)` when input is not fully trusted
- `JSON.stringify` / `JSON.parse` on circular structures without a replacer, which can cause application crashes
- `__proto__` or `constructor` keys in JSON payloads not stripped before merging into objects

## Insecure File Operations
- Temporary files created in world-readable directories with predictable names (e.g., `/tmp/upload_` + user_id) — susceptible to symlink attacks
- Files written to disk with permissions that allow other system users to read them (missing `mode: 0o600` or equivalent)
- Race condition between a file existence check and file use (TOCTOU — time-of-check to time-of-use)

## Security Logging
- Failed authentication attempts not logged (brute force attacks become invisible)
- Privilege escalation events (role changes, permission grants) not logged with actor identity
- Security-sensitive exceptions (decryption failure, signature verification failure) silently swallowed in `catch` blocks with no log entry
- Log entries for security events missing contextual data: timestamp, actor user ID, IP address, resource affected
- Security events logged at `DEBUG` level that may be suppressed in production, making them invisible during incidents

## Scope Clarification
- This reviewer does NOT cover hardcoded secrets (use `secrets` reviewer), OWASP injection attacks (use `owasp` reviewer), input schema validation (use `input-validation` reviewer), authorization logic (use `authorization-logic` reviewer), or network security headers (use `network-policy` reviewer)
