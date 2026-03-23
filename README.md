# BatEye 🦉

AI-powered code analysis CLI. Runs deep, structured reviews of your codebase using LLMs.

## Commands

```bash
bateye init               # Set up .bateye/ in your repo
bateye doctor             # Check config, API key, reviewers
bateye models             # List available AI models
bateye models anthropic   # List Anthropic models
bateye config show        # Show current config
bateye config set model anthropic/claude-sonnet-4-5

bateye reviewers                         # List all built-in and user reviewers (id, name, description)

bateye audit                             # Full codebase audit (all reviewers)
bateye audit --output ./report.json      # Custom output path
bateye audit --reviewers security-api    # Specific reviewers only

bateye pr-review                         # Review local changes (origin/main...HEAD)
bateye pr-review --base main --head HEAD
bateye pr-review --github --pr-number 42 # Post comments to GitHub PR
```

## Setup

**Prerequisites:** Node.js 18.x or later

No separate `npm i -g opencode-ai` step is required when BatEye is installed normally.
`bateye audit` and `bateye pr-review` use the OpenCode runtime bundled with BatEye, with a global `opencode` on `PATH` only as a fallback.

```bash
# Install dependencies reproducibly
npm ci

# Build
npm run build

# Run the CLI from source (no watch — re-run after changes)
npm run dev

# Run the automated checks used in local development
npm run test:unit
npm run test:integration

# Link for local development (builds first, then links)
npm run link:local

# Set your credential
export BATEYE_LLM_MODEL_API_KEY=your-provider-key

# For Vercel AI Gateway models, use OIDC instead
export VERCEL_OIDC_TOKEN=your-vercel-oidc-token

# Initialize in your target repo
cd /path/to/your/project
bateye init
bateye doctor
bateye audit
```

PowerShell:

```powershell
$env:BATEYE_LLM_MODEL_API_KEY='your-provider-key'
$env:VERCEL_OIDC_TOKEN='your-vercel-oidc-token'
```

If you prefer file-based local setup, copy [`.env.example`](./.env.example) to `.env` and fill in the values you need.
The repository commits `package-lock.json`; prefer `npm ci` for reproducible local installs.

## Configuration

`.bateye/config.json`:

```json
{
  "$schema": "./node_modules/bateye/schemas/bateye-config.schema.json",
  "model": "anthropic/claude-sonnet-4-5",
  "transport": "auto",
  "exclude": ["generated", "vendor"]
}
```

For Vercel AI Gateway, configure a Vercel-routed model and provide `VERCEL_OIDC_TOKEN`:

```json
{
  "$schema": "./node_modules/bateye/schemas/bateye-config.schema.json",
  "model": "vercel/minimax/minimax-m2.5",
  "exclude": ["generated", "vendor"]
}
```

To disable specific reviewers per mode (useful for UI-only or backend-only repos):

```json
{
  "model": "anthropic/claude-sonnet-4-5",
  "disabledReviewers": {
    "audit": ["responsiveness", "accessibility", "i18n"],
    "prReview": ["inline-docs"]
  }
}
```

## Reviewers

BatEye ships with a large built-in reviewer catalog under `src/features/audit/builtin-reviewers/`.
Examples include `security-api`, `code-quality`, `documentation`, `complexity`, `test-coverage`, and `input-validation`.

Add custom reviewers to `.bateye/reviewers/*.md`:

```markdown
---
id: my-reviewer
name: My Custom Reviewer
description: Checks for specific patterns in our codebase.
enabled: true
scopeHints:
  - service
  - api
---

Focus on:
- Custom rule 1
- Custom rule 2
```

User reviewers with the same `id` override built-in ones.

## Output

- `bateye audit` → `.bateye/out/audit.json`
- `bateye pr-review` → `.bateye/out/pr-review.json` + optional GitHub comments

## GitHub Actions — Automated PR Review

Automatically review every pull request with inline comments posted directly to GitHub.

### Quick setup (for repos using BatEye installed via npm)

**1. Copy the workflow file into your repository:**

```bash
mkdir -p .github/workflows
curl -o .github/workflows/bateye-pr-review.yml \
  https://raw.githubusercontent.com/CodeNinjaArea/BatEye/main/.github/workflows/bateye-pr-review.yml
git add .github/workflows/bateye-pr-review.yml
git commit -m "ci: add BatEye PR review workflow"
```

**2. Add your AI provider API key as a GitHub secret:**

Go to **Settings → Secrets and variables → Actions → New repository secret** and add:

| Secret name | Value |
|---|---|
| `ANTHROPIC_API_KEY` | Your Anthropic API key |

For other providers use `OPENAI_API_KEY`, `OPENROUTER_API_KEY`, or `GOOGLE_API_KEY` (and update `apiKeyEnvVariable` in `.bateye/config.json`).

**3. That's it.** BatEye will run on every new or updated PR.

### Triggers

| Event | Behaviour |
|---|---|
| PR comment `/review` | Runs the review on demand — post `/review` on any PR comment |

The workflow runs **only** when a PR comment containing `/review` is posted.  It does not run automatically on every push, which keeps CI minutes low and gives you full control over when reviews happen.

### Customise the model or reviewers

Commit a `.bateye/config.json` to your repo root and the workflow will use it automatically:

```json
{
  "model": "anthropic/claude-sonnet-4-5",
  "exclude": ["generated", "vendor"]
}
```

#### Skipping the semantic verification pass

By default BatEye runs an LLM-based **semantic verification** pass after collecting findings.  This pass cross-checks each finding against the actual diff and file content to filter false positives, but it costs additional tokens and time (typically 1–3 minutes depending on the model).

Disable it when you want faster, cheaper reviews and are willing to accept that a small number of false positives may appear:

```json
{
  "model": "anthropic/claude-sonnet-4-5",
  "prReview": {
    "semanticVerification": {
      "enabled": false
    }
  }
}
```

When `enabled` is omitted or `true` the pass runs normally (this is the default).

#### DeepSeek thinking models

If your configured model ends with `-thinking` (e.g. `vercel/deepseek/deepseek-v3.2-thinking`), BatEye automatically strips the suffix and uses the non-thinking sibling (`deepseek-v3.2`).  Thinking variants require a `reasoning_content` field in every tool-call turn, which the OpenCode runtime does not inject, causing a `GatewayInternalServerError` mid-review.  The non-thinking variant is identical in quality for structured-output tasks.

Add custom reviewers by committing `.bateye/reviewers/*.md` files (see [Reviewers](#reviewers)).

### Required permissions

The workflow uses the built-in `GITHUB_TOKEN` — no extra tokens needed:

```yaml
permissions:
  contents: read
  pull-requests: write
```

---

## Supported Providers

| Provider | Model format | API key env |
|----------|-------------|-------------|
| Anthropic | `anthropic/claude-*` | `BATEYE_LLM_MODEL_API_KEY` |
| OpenAI | `openai/gpt-*` | `BATEYE_LLM_MODEL_API_KEY` |
| OpenRouter | `openrouter/...` | `BATEYE_LLM_MODEL_API_KEY` |
| Google | `google/gemini-*` | `BATEYE_LLM_MODEL_API_KEY` |
| DeepSeek | `deepseek/...` | `BATEYE_LLM_MODEL_API_KEY` |
| Groq | `groq/...` | `BATEYE_LLM_MODEL_API_KEY` |
| Cerebras | `cerebras/...` | `BATEYE_LLM_MODEL_API_KEY` |
| Together | `together/...` | `BATEYE_LLM_MODEL_API_KEY` |
| Fireworks | `fireworks/...` | `BATEYE_LLM_MODEL_API_KEY` |
| xAI | `xai/...` | `BATEYE_LLM_MODEL_API_KEY` |
| Mistral | `mistral/...` | `BATEYE_LLM_MODEL_API_KEY` |
| Cohere | `cohere/...` | `BATEYE_LLM_MODEL_API_KEY` |
| Perplexity | `perplexity/...` | `BATEYE_LLM_MODEL_API_KEY` |
| MiniMax | `minimax/...` | `BATEYE_LLM_MODEL_API_KEY` |
| DeepInfra | `deepinfra/...` | `BATEYE_LLM_MODEL_API_KEY` |
| HuggingFace | `huggingface/...` | `BATEYE_LLM_MODEL_API_KEY` |
| Moonshot | `moonshot/...` | `BATEYE_LLM_MODEL_API_KEY` |
| Novita | `novita/...` | `BATEYE_LLM_MODEL_API_KEY` |
| SambaNova | `sambanova/...` | `BATEYE_LLM_MODEL_API_KEY` |
| Nebius | `nebius/...` | `BATEYE_LLM_MODEL_API_KEY` |
| Azure | `azure/...` | `BATEYE_LLM_MODEL_API_KEY` + `AZURE_RESOURCE_NAME` |
| Ollama (local) | `ollama/...` | _(no key needed)_ |
| LM Studio (local) | `lmstudio/...` | _(no key needed)_ |
| Vercel AI Gateway | `vercel/<provider>/<model>` | `VERCEL_OIDC_TOKEN` |

Run `bateye models` to list available models for the configured provider, or `bateye models <provider>` for any specific provider.

## Environment Variables

| Variable | Purpose |
|---|---|
| `BATEYE_LLM_MODEL_API_KEY` | API key for Anthropic, OpenAI, OpenRouter, or Google |
| `VERCEL_OIDC_TOKEN` | OIDC token for Vercel AI Gateway models |
| `AI_GATEWAY_API_KEY` | Alternative API key for Vercel AI Gateway |
| `AZURE_RESOURCE_NAME` | Azure OpenAI resource name (required for `azure/...` models) |
| `GITHUB_TOKEN` | GitHub token for posting PR comments during local `pr-review --github` runs |
| `GITHUB_REPOSITORY` | Repository slug in `owner/repo` format for local GitHub PR review |
| `PR_NUMBER` | Pull request number for local GitHub PR review |
| `BATEYE_RUNTIME` | Set to `mock` to use fixture-based responses instead of live API calls (development) |
| `BATEYE_MOCK_RUNTIME_FIXTURES` | Path to JSON fixtures file (required when `BATEYE_RUNTIME=mock`) |
| `BATEYE_MOCK_RUNTIME_LOG` | Path to log file for recording mock runtime interactions (development) |

The `apiBaseUrl` config field can point to any OpenAI-compatible gateway endpoint.

## Local GitHub PR Review

To run `bateye pr-review --github` locally, set:

- `GITHUB_TOKEN`
- `GITHUB_REPOSITORY` in `owner/repo` format
- `PR_NUMBER`

Quick smoke check after install:

```bash
npm run build
npm run test:unit
node dist/index.js --version
bateye doctor
bateye audit --reviewers code-quality
```

## Version & Upgrade

```bash
bateye --version        # Check installed version
npm install -g bateye@latest   # Upgrade to latest
```

## Troubleshooting

**API key not found**
- Verify `BATEYE_LLM_MODEL_API_KEY` is set in your environment
- For Vercel models, set `VERCEL_OIDC_TOKEN` instead
- Run `bateye doctor` to validate your config and credentials

**Model not available / request failed**
- Run `bateye models` to list available models for your provider
- Confirm the `model` field in `.bateye/config.json` uses `provider/model-id` format
- Check network connectivity; some providers may have rate limits

**No reviewers found**
- Built-in reviewers load automatically — if missing, verify the npm package is correctly installed
- Custom reviewers must live in `.bateye/reviewers/*.md` and include valid frontmatter

**OpenCode runtime unavailable**
- `audit` and `pr-review` expect the bundled OpenCode runtime from the BatEye install
- Reinstall dependencies with `npm ci`, `npm install`, or reinstall the global `bateye` package
- A separate global `opencode` install is optional and only used as a fallback

**Config validation errors**
- Run `bateye doctor` for a full config check
- Validate your `.bateye/config.json` against the schema at `node_modules/bateye/schemas/bateye-config.schema.json`

## Local Development

```bash
npm run build       # Compile TypeScript + copy templates
npm run dev         # Run the CLI from source via ts-node (no watch; re-run after changes)
node dist/index.js  # Run directly
npm link            # Install as global `bateye` command
npm run test:unit   # Fast verification for source changes
npm run test        # Unit + integration tests
```

### Mock Runtime

For integration tests and offline development, BatEye includes a fixture-based mock runtime that replays pre-recorded AI responses without making live API calls.

| Variable | Description |
|---|---|
| `BATEYE_RUNTIME=mock` | Switch to the mock runtime |
| `BATEYE_MOCK_RUNTIME_FIXTURES` | Path to the JSON fixtures file (required when `BATEYE_RUNTIME=mock`) |
| `BATEYE_MOCK_RUNTIME_LOG` | Optional path to log recorded interactions for fixture generation |

