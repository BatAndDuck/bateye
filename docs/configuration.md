# Configuration

BatEye loads `.bateye/config.json` from your repo root, then applies `.bateye/config.local.json` on top when present. Run `bateye init` to create the shared config and add the local override file to `.gitignore`.

## Local overrides

Use `.bateye/config.local.json` for machine-specific or uncommitted overrides such as a different model, transport, or temporary reviewer settings.

- `.bateye/config.json` is the shared, committed baseline.
- `.bateye/config.local.json` is optional and takes priority for any field it defines.
- Nested objects merge by key.
- Arrays are replaced, not concatenated.
- Empty string placeholders such as `"apiKey": ""` are ignored.

Example:

`.bateye/config.json`

```json
{
  "model": "openai/gpt-5.4-mini",
  "exclude": ["dist"]
}
```

`.bateye/config.local.json`

```json
{
  "model": "openai/gpt-5.4",
  "exclude": ["dist", "generated"]
}
```

Effective config:

```json
{
  "model": "openai/gpt-5.4",
  "exclude": ["dist", "generated"]
}
```

### Local-only secrets

If you want BatEye to read credentials from a gitignored file instead of environment variables or the BatEye credential store, put them in `.bateye/config.local.json`:

```json
{
  "apiKey": "",
  "githubToken": ""
}
```

- `apiKey` is used for the configured LLM provider and overrides env/store credentials when non-empty.
- `githubToken` is used by `bateye pr-review --github`.
- GitHub token precedence is: CLI `--token`, then `githubToken` from config, then `GITHUB_TOKEN`.
- These values are plaintext. Keep them in `config.local.json`, not the committed `config.json`.

## Minimal config

```json
{
  "model": "vercel/openai/gpt-5.4-nano"
}
```

## Full config reference

```json
{
  "$schema": "./node_modules/bateye/dist/schemas/bateye-config.schema.json",
  "model": "vercel/openai/gpt-5.4-nano",
  "transport": "auto",
  "reasoningEffort": "high",
  "exclude": ["generated", "vendor", "migrations"],
  "disabledReviewers": {
    "audit": ["responsiveness", "accessibility"],
    "prReview": ["inline-docs"]
  },
  "prReview": {
    "autoApprove": {
      "enabled": false,
      "maxSeverity": "low"
    }
  }
}
```

### Fields

| Field | Type | Default | Description |
|---|---|---|---|
| `model` | string | `vercel/openai/gpt-5.4-nano` | Primary model in `provider/model-id` format |
| `apiKey` | string | - | Plaintext LLM API key override. Recommended only in `.bateye/config.local.json` |
| `transport` | string | `"auto"` | Transport override. `"auto"` uses the provider prefix from `model`. In practice, leave this as `"auto"` unless you are routing a supported model through `vercel` |
| `apiBaseUrl` | string | - | Provider-specific base URL override for supported AI SDK providers. Not supported by the Codebite-backed review runtime |
| `githubToken` | string | - | Plaintext GitHub token override for `pr-review --github`. Recommended only in `.bateye/config.local.json` |
| `reasoningEffort` | string | - | Reasoning/thinking effort for models that support it. Common values: `minimal`, `low`, `medium`, `high`, `xhigh`. See [Reasoning effort](#reasoning-effort) |
| `exclude` | string[] | - | Additional paths to exclude from analysis |
| `disabledReviewers` | object | - | Reviewers to skip per mode |
| `prReview.autoApprove.enabled` | boolean | `false` | Auto-approve PRs with no high-severity findings |
| `prReview.autoApprove.maxSeverity` | `"info"` \| `"low"` \| `"medium"` | `"low"` | Highest severity allowed for auto-approve |

### Model format

Models are specified as `provider/model-id`. The provider prefix determines which API endpoint and authentication method BatEye uses. Run `bateye models <provider>` to list available model IDs for a provider.

Agentic review commands (`bateye audit`, `bateye pr-review`, and `bateye models`) currently support only `openai`, `anthropic`, `google`, `mistral`, and `vercel`.

```
anthropic/claude-sonnet-4-5     → calls Anthropic API
openai/gpt-5.4-nano             → calls OpenAI API
mistral/mistral-large-latest    → calls Mistral API
vercel/openai/gpt-5.4-nano      → calls Vercel AI Gateway (three-part format)
```

### Custom API endpoint (`apiBaseUrl`)

The Codebite-backed agentic runtime does not support `apiBaseUrl`. If `apiBaseUrl` is set, `bateye audit` and `bateye pr-review` fail fast with an explicit error instead of attempting a partially supported custom gateway path.

### Transport override

The `transport` field is usually left as `"auto"` — BatEye infers the transport from the model prefix. Set it explicitly only when routing a supported model through the Vercel AI Gateway:

```json
{
  "model": "anthropic/claude-sonnet-4-5",
  "transport": "vercel"
}
```

This sends Anthropic model requests through the Vercel AI Gateway instead of calling Anthropic directly.

### Vercel AI Gateway

For Vercel-routed models, prefer `AI_GATEWAY_API_KEY`. `VERCEL_OIDC_TOKEN` also works:

```json
{
  "model": "vercel/openai/gpt-5.4-nano"
}
```

```bash
export AI_GATEWAY_API_KEY=your-vercel-gateway-key
# or
export VERCEL_OIDC_TOKEN=your-vercel-oidc-token
```

### Disabling reviewers per mode

```json
{
  "model": "vercel/openai/gpt-5.4-nano",
  "disabledReviewers": {
    "audit": ["responsiveness", "accessibility", "i18n"],
    "prReview": ["inline-docs"]
  }
}
```

### Reasoning effort

The `reasoningEffort` field controls how much thinking/reasoning a model performs before producing its response. It applies to orchestrator, reviewer, and semantic-verification calls in both `audit` and `pr-review` modes.

```json
{
  "model": "vercel/openai/gpt-5.4-nano",
  "reasoningEffort": "high"
}
```

Or set it from the CLI:

```bash
bateye conf --reasoningEffort high
```

**Allowed values** (accepted by most providers): `minimal`, `low`, `medium`, `high`, `xhigh`.

**Provider mapping** — BatEye translates the generic string to the correct provider-specific shape:

| Transport | Wire format |
|---|---|
| `openai` / `vercel` | `openai.reasoningEffort` |
| `anthropic` | `anthropic.thinking` (adaptive, Claude 4.6+) |
| `google` | `google.thinkingConfig.thinkingBudget` (tokens: `minimal`→0, `low`→2048, `medium`→8192, `high`→24576, `xhigh`→32768) |
| `mistral` | `mistral.reasoningEffort` for `minimal`/`none` → `none`, `high`/`xhigh` → `high`; `low`/`medium` are omitted |

Providers that don't support reasoning options receive the call unchanged. Unknown effort strings for the `google` transport also result in the option being omitted rather than causing an error.

Omitting `reasoningEffort` (the default) preserves the current behaviour.

---

## Environment variables

| Variable | Purpose |
|---|---|
| `BATEYE_LLM_MODEL_API_KEY` | API key for supported direct providers such as OpenAI, Anthropic, Google, or Mistral |
| `BATEYE_LLM_MODEL_API_KEY_FALLBACK` | Fallback API key (used when primary key fails) |
| `VERCEL_OIDC_TOKEN` | OIDC token for Vercel AI Gateway models |
| `AI_GATEWAY_API_KEY` | Alternative API key for Vercel AI Gateway |
| `GITHUB_TOKEN` | GitHub token for posting PR comments in local `pr-review --github` runs |
| `GITHUB_REPOSITORY` | Repository slug (`owner/repo`) for local GitHub PR review |
| `PR_NUMBER` | Pull request number for local GitHub PR review |
| `BATEYE_RUNTIME` | Set to `mock` to use fixture-based responses (development/testing) |
| `BATEYE_MOCK_RUNTIME_FIXTURES` | Path to JSON fixtures file (required when `BATEYE_RUNTIME=mock`) |
| `BATEYE_MOCK_RUNTIME_LOG` | Path to log file for recording mock runtime interactions |
| `BATEYE_VERBOSE` | Enables verbose runtime diagnostics; set automatically by the `--verbose` CLI flag |
| `BATEYE_DIAGNOSTIC` | Enables diagnostic capture mode; set automatically by the `--diagnostic` CLI flag |
| `BATEYE_DIAGNOSTIC_DIR` | Output directory for diagnostic logs and captured prompts; defaults to `.bateye/out/diagnostics` when `--diagnostic` is enabled |

PowerShell equivalents:

```powershell
$env:BATEYE_LLM_MODEL_API_KEY='your-provider-key'
$env:VERCEL_OIDC_TOKEN='your-vercel-oidc-token'
```

Alternatively, copy `.env.example` to `.env` and fill in the values.

## Stored credentials

`bateye conf --apikey ...` stores the API key in `~/.bateye/credentials.json` so you do not need to keep exporting it for that repository.

If `.bateye/config.local.json` contains a non-empty `apiKey`, BatEye uses that first. The credential store remains the best option when you want a repo-scoped secret without putting it in the repository tree at all.

BatEye stores that credential in plaintext JSON on disk and relies on local filesystem protections rather than application-level encryption. The credentials directory is created with owner-only permissions and the file is written with restrictive permissions, but anyone who can already read files as your user can still recover the key.

---

## Output files

| Command | Output |
|---|---|
| `bateye audit` | `.bateye/out/audit.json` |
| `bateye pr-review` | `.bateye/out/pr-review.json` |

Use `--output <path>` to write to a custom location.

---

## Local GitHub PR review

To run `bateye pr-review --github` locally (outside CI):

```bash
export GITHUB_TOKEN=ghp_...
export GITHUB_REPOSITORY=owner/repo
export PR_NUMBER=42
bateye pr-review --github --pr-number 42
```
