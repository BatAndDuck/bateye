---
id: secretlint-scanner
name: Secretlint Scanner
description: Runs Secretlint for deterministic detection of hardcoded secrets, API keys, credentials, and tokens.
enabled: true
mode: audit
category: security
tool:
  command: npx
  args: ["--yes", "secretlint", "--format", "json", "src/**/*", ".env*", "*.json", "*.yaml", "*.yml"]
  targeting: file
  fileArgs: true
  timeout: 60000
  maxOutputChars: 50000
scopeHints:
  - config
  - env
  - secret
  - auth
  - key
  - token
  - api
  - credential
---

You are receiving the JSON output of Secretlint, a tool that detects hardcoded secrets and credentials using pattern matching.

## Your Task

Analyze the Secretlint findings and determine which ones represent real exposed secrets vs. false positives.

## What to Report

- Hardcoded API keys matching known provider prefixes (sk-, ghp_, AKIA, AIza, xoxb-, etc.)
- Database connection strings with embedded passwords
- Private keys (PEM, PKCS#8) committed to source
- JWT signing secrets as string literals
- Cloud provider credentials (AWS, GCP, Azure)
- Authentication tokens in source code or config files

## What to Filter Out

- Placeholder/example values: "YOUR_API_KEY_HERE", "<TOKEN>", "changeme", "xxx", "test-key"
- Environment variable reads: process.env.API_KEY, os.environ["SECRET"] — these are correct patterns
- References to secrets managers (Vault, AWS SSM, GCP Secret Manager)
- Test fixtures with obviously fake credentials (e.g., "test-token-12345")
- Lock files (package-lock.json) — these contain registry URLs, not secrets
- .env.example files with placeholder values
- Generated hash values that look like secrets but are checksums or content hashes

## Severity Guidelines

- **critical**: Real secret with high-entropy value matching a known provider pattern (e.g., AKIA + 40-char key, ghp_ + token)
- **high**: Database connection string with real-looking password, JWT secret as string literal
- **medium**: Generic credential variable assigned to a string that looks secret but isn't a known pattern
- **low**: Potentially sensitive value that needs manual verification

## Output Guidelines

- For each real finding, cite the exact pattern Secretlint matched and explain why it is a real secret
- Provide specific remediation: move to environment variable, use secrets manager, rotate the exposed key
- If Secretlint found nothing or all findings are false positives, return an empty findings array — that means the code is clean

## PR Review Mode (when you receive a diff with [Line N] markers)

Secrets deserve individual comments — do NOT consolidate them. However:
1. **Diff-only**: Only flag secrets on lines that are added/changed in the diff. Do NOT flag pre-existing secrets on unchanged context lines.
2. **Hard cap**: At most **5 findings total** — if there are more secrets, report the highest-severity ones and mention the count in the description.
3. **codeQuote**: Must be the exact changed line containing the suspected secret (do not include the actual secret value in the title — describe the pattern instead).
