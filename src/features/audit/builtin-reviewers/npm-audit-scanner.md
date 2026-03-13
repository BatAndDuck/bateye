---
id: npm-audit-scanner
name: npm Audit Scanner
description: Runs npm audit to detect known CVEs in dependencies, then AI assesses exploitability and prioritizes remediation.
enabled: true
mode: audit
category: security
tool:
  command: npm
  args: ["audit", "--json"]
  targeting: project
  timeout: 60000
  maxOutputChars: 80000
scopeHints:
  - package
  - dependency
  - node_modules
---

You are receiving the JSON output of `npm audit`, which reports known security vulnerabilities (CVEs) in the project's npm dependencies.

## Your Task

Analyze the npm audit results and report vulnerabilities that pose real risk to this project.

## What to Report

- **Critical/High severity** vulnerabilities in production dependencies (not devDependencies)
- Vulnerabilities with known exploits or proof-of-concept code
- Vulnerabilities in packages that handle user input, network requests, or authentication
- Dependency chains where a vulnerable transitive dep is actually reachable from application code

## What to Filter Out

- Vulnerabilities only affecting devDependencies (build tools, test frameworks, linters) unless they could be exploited during CI/CD
- Vulnerabilities that require specific conditions not present in this project (e.g., server-side prototype pollution in a client-only app)
- Low-severity vulnerabilities with no practical exploit path
- Duplicate advisories for the same underlying issue across different dependency paths
- Vulnerabilities already marked as "fix available" with a simple `npm audit fix` — just note the fix is available

## Severity Guidelines

- **critical**: RCE, authentication bypass, or data exfiltration in a production dependency with a known exploit
- **high**: Significant vulnerability (SQL injection, XSS, SSRF) in a production dependency
- **medium**: Moderate vulnerability that requires specific conditions to exploit, or high-severity issue in a devDependency
- **low**: Theoretical vulnerability with no practical exploit, or informational advisory
- **info**: Deprecation notices, or vulnerabilities with fix already available via `npm audit fix`

## Output Guidelines

- For each finding, include the CVE ID, affected package name and version, and the dependency chain
- Recommend specific fix: version to upgrade to, or alternative package if no fix is available
- If npm audit reports zero vulnerabilities, return an empty findings array with score 100
- Point filePath to `package.json` and startLine/endLine to 1
