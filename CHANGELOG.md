# Changelog

## Unreleased

## 0.1.4

### Added
- `bateye conf --model ... --apikey ...` for quick model switching and repo-scoped credential storage.
- Diagnostic mode and prompt capture controls for local troubleshooting.
- Provider-agnostic routing through the Vercel AI SDK plus OpenCode runtime compatibility improvements.
- `bateye reviewers` command - lists all available built-in and user-defined reviewers with their IDs and descriptions.
- `disabledReviewers` config option - disable specific reviewer IDs per mode (`audit` or `prReview`) in `.bateye/config.json`.
- Mock runtime for offline development/testing: set `BATEYE_RUNTIME=mock` with `BATEYE_MOCK_RUNTIME_FIXTURES` to replay pre-recorded AI responses without live API calls.
- `AZURE_RESOURCE_NAME` environment variable for Azure OpenAI models (`azure/...`).
- Node.js 18+ engine requirement declared in `package.json`.
- Unit tests for config resolution and reviewer discovery.
- Integration tests for the `audit` command using a mocked runtime.

### Fixed
- Native OpenAI structured-output routing for `openai/...` models such as `openai/gpt-5.4-nano`.
- PR orchestrator structured-output schema compatibility with OpenAI.
- Credential-store handling: schema validation, cross-process locking, atomic writes, and restrictive local file permissions.
- Command and integration coverage for doctor, models, conf, diagnostics, and real PR/audit routing paths.
- Semgrep SAST scanner no longer shows "Exit code undefined: unknown error" when `semgrep` is not installed - reviewer now runs without tool data instead of being skipped entirely.
- Secretlint scanner no longer shows "Exit code 2: npm warn exec package not found" - added `--yes` flag for automatic install via `npx`.
- Test environment variable `BATEYE_LLM_MODEL_API_KEY` is now saved and restored in all unit tests, preventing cross-test pollution.
- Agentic runtimes no longer require a separate global `opencode-ai` install; normal BatEye installs now bundle and resolve the OpenCode runtime automatically.

### Changed
- Reorganized core workflows into feature-oriented slices for audit, config, and reviewers.
- Moved built-in reviewer definitions into `src/features/audit/builtin-reviewers` so reviewer assets live with the audit feature.
- Replaced platform-specific asset copying with a cross-platform feature asset copy step.
- Improved built-in reviewer instructions: reduced false positives for CLI/backend projects across accessibility, responsiveness, i18n, dead-code, documentation, and dependency reviewers.
