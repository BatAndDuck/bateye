# Changelog

## Unreleased

### Added
- `codeowl reviewers` command — lists all available built-in and user-defined reviewers with their IDs and descriptions.
- `disabledReviewers` config option — disable specific reviewer IDs per mode (`audit` or `prReview`) in `.codeowl/config.json`.
- Mock runtime for offline development/testing: set `CODEOWL_RUNTIME=mock` with `CODEOWL_MOCK_RUNTIME_FIXTURES` to replay pre-recorded AI responses without live API calls.
- `AZURE_RESOURCE_NAME` environment variable for Azure OpenAI models (`azure/...`).
- Node.js 18+ engine requirement declared in `package.json`.
- Unit tests for config resolution, reviewer discovery, and system-design asset resolution.
- Integration tests for `audit` and `system-design` commands using a mocked runtime.

### Fixed
- Semgrep SAST scanner no longer shows "Exit code undefined: unknown error" when `semgrep` is not installed — reviewer now runs without tool data instead of being skipped entirely.
- Secretlint scanner no longer shows "Exit code 2: npm warn exec package not found" — added `--yes` flag for automatic install via `npx`.
- Test environment variable `CODE_OWL_LLM_MODEL_API_KEY` is now saved and restored in all unit tests, preventing cross-test pollution.

### Changed
- Reorganized core workflows into feature-oriented slices for audit, config, reviewers, and system design.
- Moved built-in reviewer definitions into `src/features/audit/builtin-reviewers` so reviewer assets live with the audit feature.
- Replaced platform-specific asset copying with a cross-platform feature asset copy step.
- Improved built-in reviewer instructions: reduced false positives for CLI/backend projects across accessibility, responsiveness, i18n, dead-code, documentation, and dependency reviewers.
