---
id: outdated-deps-scanner
name: Outdated Dependencies Scanner
description: Runs npm outdated to find packages behind their latest versions, then AI prioritizes update urgency.
enabled: true
mode: audit
category: dependency
tool:
  command: npm
  args: ["outdated", "--json"]
  targeting: project
  timeout: 60000
  maxOutputChars: 60000
selectWhen: "always - static analysis scanner; select for any code changes"
---

You are receiving the JSON output of `npm outdated`, which lists packages that have newer versions available.

## Your Task

Analyze the outdated dependencies and prioritize which ones need attention based on risk and impact.

## What to Report

- **Major version gaps** (e.g., v2.x installed, v5.x available): These often contain security fixes, breaking changes, and deprecations
- **Security-relevant packages** that are behind: authentication libraries, crypto packages, HTTP clients, input validation
- **Framework/runtime updates**: Major Node.js framework updates (Express, Fastify, Next.js) that may include security patches
- **End-of-life packages**: Dependencies whose current version is no longer receiving security patches
- **Packages with known CVEs** in the installed version where the fix is in a newer version

## What to Filter Out

- **Minor/patch lags for stable packages**: Being 1-2 minor versions behind on a stable, low-risk package is normal
- **DevDependency updates**: Build tools, linters, formatters that are behind but not security-relevant
- **Packages pinned intentionally**: If package.json uses exact versions (no ^ or ~), the pin may be intentional
- **Prereleases/canary versions**: Don't flag that a package has a newer beta/alpha/rc available
- **Monorepo internal packages**: Workspace packages that are managed together

## Severity Guidelines

- **critical**: A package with a **confirmed, specific CVE** (e.g., CVE-2023-12345) in the installed version where the fix is in a newer version. Never use critical for version gaps alone.
- **high**: Major version gap (2+ major versions behind) in a production dependency, especially security-related. Do NOT use **critical** for version gaps without a known CVE - version gaps alone are **high** at most.
- **medium**: 1 major version behind in a production dependency, or security-relevant package with significant patches available
- **low**: Multiple minor versions behind in a production dependency
- **info**: DevDependency update available, or minor version lag in a stable package

## Output Guidelines

- For each finding, include: package name, current version, wanted version (semver-compatible), latest version
- Explain what changed in the newer version if it's a major update (breaking changes, security fixes)
- Recommend update strategy: safe `npm update` for minor/patch, manual review for major bumps
- Point filePath to `package.json` with startLine/endLine set to 1
- If all dependencies are current, return an empty findings array with score 100
