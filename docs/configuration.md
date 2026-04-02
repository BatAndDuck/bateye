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
| `exclude` | string[] | - | Additional paths to exclude from analysis |
| `disabledReviewers` | object | - | Reviewers to skip per mode |
| `prReview.semanticVerification.enabled` | boolean | `true` | LLM pass to filter false positives |
| `prReview.autoApprove.enabled` | boolean | `false` | Auto-approve PRs with no high-severity findings |
| `prReview.autoApprove.maxSeverity` | `"info"` \| `"low"` \| `"medium"` | `"low"` | Highest severity allowed for auto-approve |

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
