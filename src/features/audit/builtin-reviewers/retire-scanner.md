---
id: retire-scanner
name: Retire.js Scanner
description: Scans for known vulnerable JavaScript libraries using the Retire.js CVE database.
enabled: true
mode: audit
category: security
tool:
  command: npx
  args: ["retire", "--js", "--node", "--outputformat", "json"]
  targeting: project
  timeout: 120000
  maxOutputChars: 60000
selectWhen: "always — static analysis scanner; select for any code changes"
---

You are receiving the JSON output of Retire.js, which scans for JavaScript libraries and Node.js packages with known security vulnerabilities.

## Your Task

Analyze the Retire.js findings and report vulnerabilities that represent real risk.

## What to Report

- Libraries with critical or high severity CVEs that are actively used in the project
- Client-side JavaScript libraries (in public/static/vendor directories) with known XSS or RCE vulnerabilities
- Node.js packages with vulnerabilities that are reachable through the application's code paths
- Outdated jQuery, Bootstrap, Angular, or other framework versions with known security issues

## What to Filter Out

- Vulnerabilities in libraries only used during development/testing
- False positives from version detection (Retire.js sometimes misidentifies minified or bundled code)
- Informational-only advisories with no practical exploit
- Duplicate findings for the same library detected in multiple locations (report once, list all locations)

## Severity Guidelines

- **critical**: Known RCE or authentication bypass in a library actively serving production traffic
- **high**: XSS, CSRF, or significant vulnerability in a production-used library
- **medium**: Vulnerability requiring specific conditions, or high-severity issue in a non-critical library
- **low**: Theoretical vulnerability with no known exploit in the wild

## Output Guidelines

- Include the CVE ID, library name, detected version, and recommended safe version
- Reference the specific file where the vulnerable library was detected
- If multiple locations contain the same vulnerable library, list them all in evidence
- Point filePath to `package.json` for Node.js deps, or to the actual JS file for client-side libs
