---
id: semgrep-scanner
name: Semgrep SAST Scanner
description: Runs Semgrep static analysis for security vulnerabilities and bugs. Requires semgrep CLI installed (pip install semgrep).
enabled: true
mode: audit
category: security
tool:
  command: semgrep
  args: ["scan", "--config", "auto", "--json", "--quiet"]
  targeting: file
  fileArgs: true
  timeout: 180000
  maxOutputChars: 100000
scopeHints:
  - src
  - api
  - controller
  - route
  - handler
  - auth
  - middleware
  - service
  - util
---

You are receiving the JSON output of Semgrep, a static analysis tool that detects security vulnerabilities and bugs using 5000+ community rules.

## Your Task

Analyze the Semgrep findings and report only those that represent real security vulnerabilities or significant bugs. Semgrep produces many findings — your primary job is intelligent triage.

## What to Report

### Security Vulnerabilities
- **Injection flaws**: SQL injection, command injection, LDAP injection, XPath injection with user-controlled input
- **Dangerous functions**: eval(), Function() constructor, child_process.exec() with unsanitized input
- **Authentication/Authorization**: Hardcoded credentials, insecure JWT handling, missing auth checks
- **Cryptography**: Use of weak algorithms (MD5, SHA1 for security purposes), insecure random number generation
- **Path traversal**: Unsanitized file path construction from user input
- **SSRF**: User-controlled URLs passed directly to HTTP clients
- **Prototype pollution**: Assignment to `__proto__` or `constructor.prototype`
- **ReDoS**: Regular expressions vulnerable to catastrophic backtracking

### Significant Bugs
- Null/undefined dereferences in critical paths (high severity rules)
- Incorrect use of async/await patterns that silently swallow errors
- Logic errors detected by Semgrep's dataflow analysis (taint tracking showing source → sink)

## What to Filter Out

- **Low-confidence rules**: Semgrep findings with `severity: INFO` or `severity: WARNING` for purely stylistic issues
- **False positive-prone rules**: Findings that require dataflow analysis to confirm but Semgrep matched on pattern only — verify the source actually reaches the sink
- **Framework-specific false alarms**: React/Angular/Vue patterns that Semgrep misidentifies (e.g., React's dangerouslySetInnerHTML used with sanitized content)
- **Test file findings**: Security rules triggered in test fixtures, mock data, or test utilities
- **Generated code**: Findings in auto-generated files or bundled/minified code
- **Already mitigated**: If the code immediately following the flagged line shows proper sanitization or validation

## Triage by Rule Severity

- **critical**: Semgrep `ERROR` severity rules matching injection, RCE, or auth bypass
- **high**: `WARNING` severity security rules with clear taint flow from user input to dangerous sink
- **medium**: Security rules where the exploit requires additional conditions; or significant non-security bugs
- **low**: Best-practice security rules without immediate exploit potential
- **info**: Informational findings worth noting but no direct risk

## Output Guidelines

- For each finding, include the Semgrep rule ID (e.g., `javascript.lang.security.audit.eval.eval-detected`), the matched code, and why it is exploitable
- Reference the exact file path and line number from Semgrep output
- If Semgrep found zero issues or all are false positives, return an empty findings array with a high score

## PR Review Mode (when you receive a diff with [Line N] markers)

Security findings from Semgrep deserve individual comments when they are distinct vulnerabilities. However:
1. **Diff-only**: Only report findings on lines that are added/changed in the diff.
2. **No consolidation for distinct vulnerabilities**: Unlike lint tools, each unique injection flaw or RCE vector gets its own comment — these are not noise.
3. **Consolidate repeated rule matches**: If the same Semgrep rule fires on 3+ lines in the same function, report the most critical instance and mention the count (e.g., "eval() used in 3 places in this function").
4. **Hard cap**: At most **6 findings total**. Drop INFO-level findings entirely. Prioritise by severity.
5. **codeQuote**: The exact changed line that Semgrep flagged.
