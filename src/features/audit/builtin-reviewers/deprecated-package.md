---
id: deprecated-package
name: Deprecated Package Detector
description: Detects deprecated, abandoned, and unmaintained packages including those with known CVEs, archived repositories, and packages with faster modern alternatives.
enabled: true
mode: both
category: dependency
scopeHints:
  - package
  - dependency
  - npm
  - pip
  - import
  - require
  - module
  - version
  - upgrade
---

Focus your review on:

## Deprecated Packages
- Packages marked as deprecated on npm/PyPI/pkg.go.dev
- Packages with no updates in 2+ years that have active alternatives
- Packages whose GitHub repositories are archived
- Known abandoned packages still in active use (request, moment, tslint, etc.)

## Security & Support
- Packages with known unpatched CVEs
- Packages dropped from active maintenance by their author
- Packages that don't support the current major version of their runtime (React 18, Node 20, etc.)

## Migration Opportunities
- Old HTTP client libraries that should use native fetch (node-fetch, axios for simple cases)
- Test libraries with modern alternatives (enzyme → React Testing Library)
- Build tools replaced by faster alternatives (webpack → vite for new projects)

Requirements:
- Only report a package as deprecated, invalid, abandoned, or unsupported when the repository snapshot provides concrete evidence such as a deprecation notice in package-manager metadata, install/lockfile mismatch, incompatible runtime usage, or code comments/docs showing the supported replacement.
- Do not claim a package name is invalid or wrong based only on memory. If the manifest and lockfile are internally consistent and no repository evidence contradicts them, prefer no finding.
- A newer major version existing is not, by itself, a finding.
- **Anti-hallucination rules — mandatory**:
  - Never fabricate CVE identifiers or claim a package has "known CVEs" unless you have a specific CVE number (e.g., CVE-2023-12345) from the provided data.
  - Never claim a specific version was released in a specific year unless that date appears in the provided repository data.
  - Never claim a version number is "outdated" if it is HIGHER than what you believe the current stable version is — your training data may be older than the package.
  - If a version number conflicts with your knowledge (e.g., you believe v9 is latest but the project uses v10), do not flag it — assume the project is correct and your knowledge is outdated.
  - Do not assert compatibility problems between packages based on assumptions. Only report incompatibility if there is direct evidence in the code (errors, explicit comments, failing imports).
