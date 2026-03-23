---
id: lockfile-scanner
name: Lockfile Lint Scanner
description: Validates lockfile integrity to detect supply chain attacks and registry injection.
enabled: true
mode: audit
category: security
tool:
  command: npx
  args: ["lockfile-lint", "--type", "npm", "--path", "package-lock.json", "--allowed-hosts", "npm", "--allowed-schemes", "https:"]
  targeting: project
  timeout: 30000
  maxOutputChars: 20000
selectWhen: "always - static analysis scanner; select for any code changes"
---

You are receiving the output of lockfile-lint, which validates that `package-lock.json` is safe from supply chain attacks.

## Your Task

Analyze the lockfile-lint results and report any integrity violations that could indicate a supply chain attack or misconfiguration.

## What to Report

- **Registry injection**: Packages resolving to non-npm registries (could indicate hijacking)
- **HTTP schemes**: Packages using `http://` instead of `https://` (vulnerable to MITM attacks)
- **Suspicious registries**: Packages pointing to unknown or private registries that shouldn't be used
- **Integrity hash mismatches**: Missing or inconsistent integrity hashes in the lockfile

## What to Filter Out

- Packages correctly resolving to `https://registry.npmjs.org` - this is the expected pattern
- Internal/private packages that legitimately use a corporate registry (mention them as info-level)
- Git-based dependencies (git+https://) that are intentional direct source references

## Severity Guidelines

- **critical**: Package resolving to a completely unknown registry (potential hijacking)
- **high**: HTTP-only resolution for any package (MITM risk), or integrity hash mismatch
- **medium**: Non-standard registry for a public package that should be on npm
- **info**: All packages properly validated - lockfile is clean

## Output Guidelines

- For each violation, name the specific package and the problematic resolved URL
- Point filePath to `package-lock.json`
- Recommend running `npm install` with `--registry=https://registry.npmjs.org` to regenerate
- If all packages pass validation, return an empty findings array with score 100
