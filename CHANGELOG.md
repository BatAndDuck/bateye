# Changelog

## Unreleased

### Changed
- Reorganized core workflows into feature-oriented slices for audit, config, reviewers, and system design.
- Moved built-in reviewer definitions into `src/features/audit/builtin-reviewers` so reviewer assets live with the audit feature.
- Replaced platform-specific asset copying with a cross-platform feature asset copy step.

### Added
- Unit tests for config resolution, reviewer discovery, and system-design asset resolution.
- Integration tests for `audit` and `system-design` commands using a mocked runtime.
