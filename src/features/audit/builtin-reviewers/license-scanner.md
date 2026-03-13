---
id: license-scanner
name: License Compliance Scanner
description: Scans production dependency licenses for restrictive or problematic licensing that may conflict with project goals.
enabled: true
mode: audit
category: compliance
tool:
  command: npx
  args: ["license-checker", "--json", "--production"]
  targeting: project
  timeout: 60000
  maxOutputChars: 80000
scopeHints:
  - package
  - license
  - dependency
---

You are receiving the JSON output of license-checker, which lists the license of every production dependency.

## Your Task

Analyze the dependency licenses and flag any that could create legal or compliance issues.

## What to Report

- **Copyleft licenses** in production dependencies that may require source disclosure:
  - GPL-2.0, GPL-3.0 (strong copyleft — may require entire project to be GPL)
  - AGPL-3.0 (network copyleft — even SaaS use requires source disclosure)
  - SSPL (Server Side Public License — similar to AGPL but more restrictive)
  - EUPL (European Union Public License — copyleft with jurisdiction concerns)
- **Non-standard or unknown licenses**: "UNLICENSED", "SEE LICENSE IN ...", custom licenses
- **Missing license information**: Dependencies with no license field at all
- **Commercial/proprietary licenses**: Dependencies that may require paid licensing for commercial use
- **License conflicts**: Multiple incompatible licenses in the dependency tree

## What to Filter Out

- **Permissive licenses** (these are safe for any use): MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, CC0-1.0, Unlicense, 0BSD, BlueOak-1.0.0
- **Weak copyleft** (generally safe when used as a library): LGPL-2.1, LGPL-3.0, MPL-2.0 (note these as info-level if relevant)
- DevDependencies — license-checker is run with --production so these should already be excluded
- CC-BY licenses for documentation/data packages

## Severity Guidelines

- **critical**: AGPL-3.0 or SSPL in a production dependency of a proprietary/commercial project
- **high**: GPL-2.0 or GPL-3.0 in a production dependency (strong copyleft obligations)
- **medium**: Unknown or missing license, custom license requiring manual review
- **low**: Weak copyleft (LGPL, MPL) that is properly used as a library (no modification)
- **info**: All licenses are permissive — dependency tree is clean

## Output Guidelines

- For each flagged dependency, list the package name, version, detected license, and repository URL
- Explain the specific obligation the license creates (source disclosure, patent grant, etc.)
- Point filePath to `package.json` with startLine/endLine set to 1
- If all dependencies have permissive licenses, return an empty findings array with score 100
