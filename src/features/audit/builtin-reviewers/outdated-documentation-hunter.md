---
id: outdated-documentation-hunter
name: Outdated Documentation Hunter
description: Hunts for outdated documentation (md files, comments) that should be updated based on code changes.
enabled: true
mode: audit
category: documentation
scopeHints:
  - readme
  - docs
  - changelog
  - comment
  - doc
  - guide
  - wiki
recommendedGlobs:
  - "**/*.md"
  - "**/*.mdx"
  - "**/*.txt"
  - "**/*.rst"
---

Focus your review on:

## Feature and Command Documentation
- README sections that describe CLI commands, flags, or subcommands that no longer exist in the codebase (removed or renamed commands still documented as available)
- Documentation for configuration options (`--config`, config file fields) that have been removed, renamed, or had their default values changed
- Documented output formats, file structures, or generated artifact layouts that differ from what the code currently produces
- Feature descriptions in README that describe behavior that has been removed or significantly altered in the implementation

## Installation and Setup Instructions
- Installation instructions referencing packages, binaries, or repositories that have been renamed, moved, or removed (e.g., old npm package name, outdated Homebrew tap)
- Setup steps that reference commands or scripts (`npm run setup`, `make install`) that no longer exist in the repository's `package.json`, `Makefile`, or equivalent
- Prerequisites section listing minimum runtime versions (Node.js 14, Python 3.8) that no longer match the actual minimum enforced by the code or CI pipeline
- Instructions to configure environment variables that no longer exist in the codebase (variables that have been removed or replaced)

## Code Examples in Documentation
- Code examples in docs (README, tutorials, inline JSDoc examples) that use function names, import paths, or APIs that have been renamed or removed
- Code samples that reference configuration fields or option names that no longer match the current implementation
- Example commands in docs that produce output formats different from what the current code actually outputs
- Sample configuration file snippets in docs that include deprecated or removed fields, or are missing newly required fields

## Architectural and Structural Descriptions
- Architecture sections in README or docs that describe a module structure, file layout, or component hierarchy that has been significantly refactored
- Descriptions of the data flow or processing pipeline that conflict with how the code actually works after a major refactor
- Diagrams or descriptions naming specific files, classes, or modules that have been renamed, merged, or deleted
- Documentation describing dependencies or integrations (external services, libraries) that are no longer used

## Version and Release References
- Version numbers in documentation (README badges, compatibility tables, changelogs) that are significantly behind the current version in `package.json` or equivalent manifest
- Documentation that references a specific library version (e.g., "requires express v4") when the actual dependency has been upgraded to a different major version
- "Coming soon" or "planned" feature notes in docs for features that have already been shipped
- Release status labels ("alpha", "beta", "experimental") in docs that have not been updated after the feature reached stable status

## File and Path References
- Documentation that references specific file paths (e.g., `src/config/default.ts`, `templates/email/welcome.html`) that no longer exist at those paths
- Links to other documentation files within the repository (`[see here](./docs/setup.md)`) that point to files that have been moved or deleted
- References to CI configuration files, Makefile targets, or scripts by name that have been renamed or removed
- `package.json` script names referenced in docs (e.g., "run `npm run generate`") that no longer exist in the scripts section

## External Links and References
- Links to external documentation, issue trackers, or websites that return 404 or have been redirected to unrelated content
- References to third-party service features or APIs (by name and behavior) that the service has since changed or deprecated
- Documentation of integration patterns with external services that conflict with the current version of those services' APIs
