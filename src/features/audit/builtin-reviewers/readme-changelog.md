---
id: readme-changelog
name: README & Changelog
description: Prompts documentation updates when significant features or breaking changes are introduced.
enabled: true
mode: both
category: documentation
scopeHints:
  - readme
  - changelog
  - docs
  - release
  - version
  - breaking
  - feature
recommendedGlobs:
  - "**/*.md"
  - "**/*.ts"
  - "**/*.js"
  - "**/*.py"
  - "CHANGELOG*"
  - "README*"
---

Focus your review on:

## New Features and Commands
- New CLI commands, subcommands, or flags added to the codebase without a corresponding README section describing their usage, options, and examples
- New API endpoints or significant new functionality introduced without README documentation explaining the use case and how to invoke it
- New configuration options (config file fields, constructor options, class properties) added without documentation in the README or a dedicated configuration reference

## Environment Variables and Setup
- New environment variables introduced (`process.env.NEW_VAR`, `os.environ["NEW_VAR"]`) without a corresponding entry in `.env.example` showing the variable name and an example or placeholder value
- New environment variables not documented in the README's "Setup" or "Configuration" section
- Required environment variables made optional (or vice versa) without updating the README and `.env.example` to reflect the change
- New external service dependencies (third-party APIs, databases, message queues) added without README instructions for provisioning or configuring them locally

## CHANGELOG Entries
- Breaking changes (removed features, changed behavior, renamed config fields, changed defaults) introduced without a CHANGELOG entry under an `## [Unreleased]` or version-specific section
- Significant new features that users would benefit from knowing about (new commands, new integrations, new output formats) missing from the CHANGELOG
- Bug fixes that address commonly reported issues not recorded in the CHANGELOG
- CHANGELOG entries present but placed under the wrong version heading, or formatted inconsistently with the existing changelog style (Keep a Changelog, conventional commits, etc.)

## Deprecated Features
- Features, functions, or configuration options marked as deprecated in code (via `@deprecated` JSDoc, deprecation warnings) still documented in the README as active and recommended
- Deprecated CLI flags or commands not noted as deprecated in the README with guidance on the replacement
- Migration path from deprecated to new behavior not documented for users who need to update their usage

## Version Consistency
- Version number incremented in `package.json`, `pyproject.toml`, or equivalent without a corresponding CHANGELOG entry for that version
- CHANGELOG contains entries for a version that differs from the current version in the package manifest
- Git tags or release notes referenced in documentation that do not correspond to actual tagged releases in the repository

## Dependency Documentation
- New dependencies added with significant security or license implications (GPL-licensed package, dependency with known CVEs, telemetry-enabled SDK) not noted in the README or CHANGELOG
- New peer dependencies or runtime requirements added (new minimum Node.js version, new system library required) without updating the README's prerequisites section
- Dependencies removed that users may have relied on for a documented integration, with no migration notice

## Migration Guides
- Breaking changes to configuration file format, environment variable names, or CLI flag syntax introduced without a migration guide or upgrade instructions
- Major version bumps without a migration guide explaining what changed and how users should update their setup
- Database schema migrations included in the codebase without corresponding documentation on how to run them during an upgrade
