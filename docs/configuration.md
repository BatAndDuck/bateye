# Configuration

BatEye is configured via `.bateye/config.json` in your repo root. Run `bateye init` to create it.

## Minimal config

```json
{
  "model": "anthropic/claude-sonnet-4-5"
}
```

## Full config reference

```json
{
  "$schema": "./node_modules/bateye/dist/schemas/bateye-config.schema.json",
  "model": "anthropic/claude-sonnet-4-5",
  "transport": "auto",
  "reasoningEffort": "high",
  "exclude": ["generated", "vendor", "migrations"],
  "disabledReviewers": {
    "audit": ["responsiveness", "accessibility"],
    "prReview": ["inline-docs"]
  },
  "prReview": {
    "semanticVerification": {
      "enabled": true
    },
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
| `model` | string | `vercel/deepseek/deepseek-v3.2-thinking` | Primary model in `provider/model-id` format |
| `transport` | string | `"auto"` | HTTP transport/gateway override. `"auto"` uses the provider prefix from `model`. Use `"vercel"`, `"openrouter"`, etc. to route through a gateway |
| `apiBaseUrl` | string | - | OpenAI-compatible base URL for custom gateways or proxies |
| `reasoningEffort` | string | - | Reasoning/thinking effort for models that support it. Common values: `minimal`, `low`, `medium`, `high`, `xhigh`. See [Reasoning effort](#reasoning-effort) |
| `exclude` | string[] | - | Additional paths to exclude from analysis |
| `disabledReviewers` | object | - | Reviewers to skip per mode |
| `prReview.semanticVerification.enabled` | boolean | `true` | LLM pass to filter false positives |
| `prReview.autoApprove.enabled` | boolean | `false` | Auto-approve PRs with no high-severity findings |
| `prReview.autoApprove.maxSeverity` | `"info"` \| `"low"` \| `"medium"` | `"low"` | Highest severity allowed for auto-approve |

### Model format

Models are specified as `provider/model-id`. The provider prefix determines which API endpoint and authentication method BatEye uses. Run `bateye models <provider>` to list available model IDs for a provider.

```
anthropic/claude-sonnet-4-5     → calls Anthropic API
openai/gpt-4o                   → calls OpenAI API
litellm/my-model                → calls LiteLLM proxy at localhost:4000
vercel/openai/gpt-4o            → calls Vercel AI Gateway (three-part format)
```

### Custom API endpoint (`apiBaseUrl`)

Set `apiBaseUrl` to route requests through a custom OpenAI-compatible endpoint (LiteLLM proxy, internal gateway, etc.):

```json
{
  "model": "litellm/gpt-4o",
  "apiBaseUrl": "https://llm.internal.company.com/v1"
}
```

When `apiBaseUrl` is set, BatEye routes all LLM traffic through that URL. The model name after the prefix must match what your endpoint exposes. See [Providers → LiteLLM proxy](./providers.md#litellm-proxy) and [Providers → Custom gateway](./providers.md#custom-openai-compatible-gateway) for examples.

### Transport override

The `transport` field is usually left as `"auto"` — BatEye infers the transport from the model prefix. Set it explicitly only when routing through a gateway that differs from the model's native provider:

```json
{
  "model": "anthropic/claude-sonnet-4-5",
  "transport": "vercel"
}
```

This sends Anthropic model requests through the Vercel AI Gateway instead of calling Anthropic directly.

### Vercel AI Gateway

For Vercel-routed models, use `VERCEL_OIDC_TOKEN` instead of an API key:

```json
{
  "model": "vercel/minimax/minimax-m2.5"
}
```

```bash
export VERCEL_OIDC_TOKEN=your-vercel-oidc-token
```

### Disabling reviewers per mode

```json
{
  "model": "anthropic/claude-sonnet-4-5",
  "disabledReviewers": {
    "audit": ["responsiveness", "accessibility", "i18n"],
    "prReview": ["inline-docs"]
  }
}
```

### Semantic verification

The semantic verification pass cross-checks each finding against the actual diff and file content to filter false positives. It costs extra tokens (typically 1–3 min) but significantly reduces noise.

Disable if you want faster, cheaper reviews and can tolerate some false positives:

```json
{
  "prReview": {
    "semanticVerification": {
      "enabled": false
    }
  }
}
```

### Reasoning effort

The `reasoningEffort` field controls how much thinking/reasoning a model performs before producing its response. It applies to orchestrator, reviewer, and semantic-verification calls in both `audit` and `pr-review` modes.

```json
{
  "model": "openai/gpt-5",
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
| `openai` / `azure` / `vercel` | `openai.reasoningEffort` |
| `openrouter` | `openrouter.reasoning.effort` |
| `groq` | `groq.reasoningEffort` |
| `anthropic` | `anthropic.thinking` (adaptive, Claude 4.6+) |
| `google` / `gemini` | `google.thinkingConfig.thinkingBudget` (tokens: `minimal`→0, `low`→2048, `medium`→8192, `high`→24576, `xhigh`→32768) |

Providers that don't support reasoning options receive the call unchanged — BatEye silently omits the option for unrecognised transports. Unknown effort strings for the `google`/`gemini` transport also result in the option being omitted rather than causing an error.

Omitting `reasoningEffort` (the default) preserves the current behaviour.

### DeepSeek thinking models

If your model ends with `-thinking` (e.g. `vercel/deepseek/deepseek-v3.2-thinking`), BatEye automatically strips the suffix. Thinking variants require a `reasoning_content` field in every tool-call turn that the runtime doesn't inject - the non-thinking variant is identical in quality for structured-output tasks.

---

## Environment variables

| Variable | Purpose |
|---|---|
| `BATEYE_LLM_MODEL_API_KEY` | API key for your AI provider (Anthropic, OpenAI, OpenRouter, Google, etc.) |
| `BATEYE_LLM_MODEL_API_KEY_FALLBACK` | Fallback API key (used when primary key fails) |
| `VERCEL_OIDC_TOKEN` | OIDC token for Vercel AI Gateway models |
| `AI_GATEWAY_API_KEY` | Alternative API key for Vercel AI Gateway |
| `AZURE_RESOURCE_NAME` | Azure OpenAI resource name (required for `azure/...` models) |
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
