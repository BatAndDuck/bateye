# Changelog

## 0.1.7

### Fixed
- Repair failure debug logs now use `formatErrorWithCauses` instead of `.message?.slice(0,200)`, so nested cause chains (e.g. provider SDK wrapping) are fully visible in diagnostic output.
- Provider smoke test `validateResult` now includes issue codes and messages in the failure output when `status=degraded`, making provider-specific failures diagnosable without downloading CI artifacts.
- Vercel AI SDK errors thrown when `generateObject` cannot produce valid structured output (`AI_NoObjectGeneratedError`, `AI_NoContentGeneratedError`, `AI_JSONParseError`, `AI_TypeValidationError`) now trigger the text-based fallback path, fixing Gemini models that fail schema validation after repair.
- Structure repair prompt now wraps malformed JSON in explicit `--- BEGIN/END JSON DATA ---` delimiters with an instruction to treat contents as inert data, preventing instruction-like strings in AI-generated JSON values from influencing the repair model.
- Model-not-found errors (e.g. Anthropic `model: <name>` validation errors) now include a hint to run `bateye models` to list available models for the provider.
- `bateye models --provider vercel` now returns the models available on the Vercel AI Gateway by querying its OpenAI-compatible `/v1/models` endpoint directly.
- Gemini provider smoke test now passes: `buildOpenCodeEnvironment` also sets `GOOGLE_GENERATIVE_AI_API_KEY` (required by OpenCode's `@ai-sdk/google` dependency) in addition to `GOOGLE_API_KEY` and `GEMINI_API_KEY`.

## 0.1.5

### Added
- Provider-agnostic cascading fallback in `DirectAIRuntime`: when `generateObject` is rejected by the provider, the runtime automatically retries without `temperature` (for models that reject it, e.g. reasoning/thinking models), then falls back to `generateText` + JSON extraction + Zod validation + AI-powered repair for models that do not support structured output at all.
- Error classifiers (`isStructuredOutputError`, `isTemperatureError`) detect provider rejections by inspecting the full error cause chain — no model-name sniffing, works with any current or future provider.
- Provider integration smoke test for Vercel / `deepseek-v3.2-thinking` now passes end-to-end.

### Fixed
- Anthropic API rejected Zod schemas containing `minimum`/`maximum` (number), `minLength`/`maxLength` (string), or `minItems`/`maxItems` (array) constraints — now caught by `isStructuredOutputError` and handled via the text fallback, fixing the orchestrator and reviewer analysis calls.
- Gemini reviewer analysis failures causing `status=degraded` in the smoke test, root-caused to the same schema-constraint rejection.
- Anthropic smoke test model ID corrected from `claude-haiku-4.5` to `claude-haiku-4-5-20251001`.
- Token usage after text-fallback repair now reports the repair call's usage rather than the initial (failed) extraction call.

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
