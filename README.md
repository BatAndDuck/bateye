# CodeOwl 🦉

AI-powered code analysis CLI. Runs deep, structured reviews of your codebase using LLMs.

## Commands

```bash
codeowl init               # Set up .codeowl/ in your repo
codeowl doctor             # Check config, API key, reviewers
codeowl models             # List available AI models
codeowl models anthropic   # List Anthropic models
codeowl config show        # Show current config
codeowl config set model anthropic/claude-sonnet-4-5

codeowl reviewers                         # List all built-in and user reviewers (id, name, description)

codeowl audit                             # Full codebase audit (all reviewers)
codeowl audit --output ./report.json      # Custom output path
codeowl audit --reviewers security-api    # Specific reviewers only

codeowl pr-review                         # Review local changes (origin/main...HEAD)
codeowl pr-review --base main --head HEAD
codeowl pr-review --github --pr-number 42 # Post comments to GitHub PR

codeowl system-design                     # Generate architecture docs + interactive graph
codeowl system-design --output ./out
```

## Setup

**Prerequisites:** Node.js 18.x or later

No separate `npm i -g opencode-ai` step is required when CodeOwl is installed normally.
`codeowl audit` and `codeowl pr-review` use the OpenCode runtime bundled with CodeOwl, with a global `opencode` on `PATH` only as a fallback.

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
export CODE_OWL_LLM_MODEL_API_KEY=your-provider-key

# For Vercel AI Gateway models, use OIDC instead
export VERCEL_OIDC_TOKEN=your-vercel-oidc-token

# Initialize in your target repo
cd /path/to/your/project
codeowl init
codeowl doctor
codeowl audit
```

PowerShell:

```powershell
$env:CODE_OWL_LLM_MODEL_API_KEY='your-provider-key'
$env:VERCEL_OIDC_TOKEN='your-vercel-oidc-token'
```

If you prefer file-based local setup, copy [`.env.example`](./.env.example) to `.env` and fill in the values you need.
The repository commits `package-lock.json`; prefer `npm ci` for reproducible local installs.

## Configuration

`.codeowl/config.json`:

```json
{
  "$schema": "./node_modules/codeowl/schemas/codeowl-config.schema.json",
  "model": "anthropic/claude-sonnet-4-5",
  "transport": "auto",
  "exclude": ["generated", "vendor"]
}
```

For Vercel AI Gateway, configure a Vercel-routed model and provide `VERCEL_OIDC_TOKEN`:

```json
{
  "$schema": "./node_modules/codeowl/schemas/codeowl-config.schema.json",
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

CodeOwl ships with a large built-in reviewer catalog under `src/features/audit/builtin-reviewers/`.
Examples include `security-api`, `code-quality`, `documentation`, `complexity`, `test-coverage`, and `input-validation`.

Add custom reviewers to `.codeowl/reviewers/*.md`:

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

- `codeowl audit` → `.codeowl/out/audit.json`
- `codeowl pr-review` → `.codeowl/out/pr-review.json` + optional GitHub comments
- `codeowl system-design` → `.codeowl/out/system-design/index.html` (interactive graph)

## GitHub Actions — Automated PR Review

Automatically review every pull request with inline comments posted directly to GitHub.

### Quick setup (for repos using CodeOwl installed via npm)

**1. Copy the workflow file into your repository:**

```bash
mkdir -p .github/workflows
curl -o .github/workflows/codeowl-pr-review.yml \
  https://raw.githubusercontent.com/CodeNinjaArea/CodeOwl/main/.github/workflows/codeowl-pr-review.yml
git add .github/workflows/codeowl-pr-review.yml
git commit -m "ci: add CodeOwl PR review workflow"
```

**2. Add your AI provider API key as a GitHub secret:**

Go to **Settings → Secrets and variables → Actions → New repository secret** and add:

| Secret name | Value |
|---|---|
| `ANTHROPIC_API_KEY` | Your Anthropic API key |

For other providers use `OPENAI_API_KEY`, `OPENROUTER_API_KEY`, or `GOOGLE_API_KEY` (and update `apiKeyEnvVariable` in `.codeowl/config.json`).

**3. That's it.** CodeOwl will run on every new or updated PR.

### Triggers

| Event | Behaviour |
|---|---|
| PR comment `/review` | Runs the review on demand — post `/review` on any PR comment |

The workflow runs **only** when a PR comment containing `/review` is posted.  It does not run automatically on every push, which keeps CI minutes low and gives you full control over when reviews happen.

### Customise the model or reviewers

Commit a `.codeowl/config.json` to your repo root and the workflow will use it automatically:

```json
{
  "model": "anthropic/claude-sonnet-4-5",
  "exclude": ["generated", "vendor"]
}
```

#### Skipping the semantic verification pass

By default CodeOwl runs an LLM-based **semantic verification** pass after collecting findings.  This pass cross-checks each finding against the actual diff and file content to filter false positives, but it costs additional tokens and time (typically 1–3 minutes depending on the model).

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

If your configured model ends with `-thinking` (e.g. `vercel/deepseek/deepseek-v3.2-thinking`), CodeOwl automatically strips the suffix and uses the non-thinking sibling (`deepseek-v3.2`).  Thinking variants require a `reasoning_content` field in every tool-call turn, which the OpenCode runtime does not inject, causing a `GatewayInternalServerError` mid-review.  The non-thinking variant is identical in quality for structured-output tasks.

Add custom reviewers by committing `.codeowl/reviewers/*.md` files (see [Reviewers](#reviewers)).

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
| Anthropic | `anthropic/claude-*` | `CODE_OWL_LLM_MODEL_API_KEY` |
| OpenAI | `openai/gpt-*` | `CODE_OWL_LLM_MODEL_API_KEY` |
| OpenRouter | `openrouter/...` | `CODE_OWL_LLM_MODEL_API_KEY` |
| Google | `google/gemini-*` | `CODE_OWL_LLM_MODEL_API_KEY` |
| DeepSeek | `deepseek/...` | `CODE_OWL_LLM_MODEL_API_KEY` |
| Groq | `groq/...` | `CODE_OWL_LLM_MODEL_API_KEY` |
| Cerebras | `cerebras/...` | `CODE_OWL_LLM_MODEL_API_KEY` |
| Together | `together/...` | `CODE_OWL_LLM_MODEL_API_KEY` |
| Fireworks | `fireworks/...` | `CODE_OWL_LLM_MODEL_API_KEY` |
| xAI | `xai/...` | `CODE_OWL_LLM_MODEL_API_KEY` |
| Mistral | `mistral/...` | `CODE_OWL_LLM_MODEL_API_KEY` |
| Cohere | `cohere/...` | `CODE_OWL_LLM_MODEL_API_KEY` |
| Perplexity | `perplexity/...` | `CODE_OWL_LLM_MODEL_API_KEY` |
| MiniMax | `minimax/...` | `CODE_OWL_LLM_MODEL_API_KEY` |
| DeepInfra | `deepinfra/...` | `CODE_OWL_LLM_MODEL_API_KEY` |
| HuggingFace | `huggingface/...` | `CODE_OWL_LLM_MODEL_API_KEY` |
| Moonshot | `moonshot/...` | `CODE_OWL_LLM_MODEL_API_KEY` |
| Novita | `novita/...` | `CODE_OWL_LLM_MODEL_API_KEY` |
| SambaNova | `sambanova/...` | `CODE_OWL_LLM_MODEL_API_KEY` |
| Nebius | `nebius/...` | `CODE_OWL_LLM_MODEL_API_KEY` |
| Azure | `azure/...` | `CODE_OWL_LLM_MODEL_API_KEY` + `AZURE_RESOURCE_NAME` |
| Ollama (local) | `ollama/...` | _(no key needed)_ |
| LM Studio (local) | `lmstudio/...` | _(no key needed)_ |
| Vercel AI Gateway | `vercel/<provider>/<model>` | `VERCEL_OIDC_TOKEN` |

Run `codeowl models` to list available models for the configured provider, or `codeowl models <provider>` for any specific provider.

## Environment Variables

| Variable | Purpose |
|---|---|
| `CODE_OWL_LLM_MODEL_API_KEY` | API key for Anthropic, OpenAI, OpenRouter, or Google |
| `VERCEL_OIDC_TOKEN` | OIDC token for Vercel AI Gateway models |
| `AI_GATEWAY_API_KEY` | Alternative API key for Vercel AI Gateway |
| `AZURE_RESOURCE_NAME` | Azure OpenAI resource name (required for `azure/...` models) |
| `GITHUB_TOKEN` | GitHub token for posting PR comments during local `pr-review --github` runs |
| `GITHUB_REPOSITORY` | Repository slug in `owner/repo` format for local GitHub PR review |
| `PR_NUMBER` | Pull request number for local GitHub PR review |
| `CODEOWL_RUNTIME` | Set to `mock` to use fixture-based responses instead of live API calls (development) |
| `CODEOWL_MOCK_RUNTIME_FIXTURES` | Path to JSON fixtures file (required when `CODEOWL_RUNTIME=mock`) |
| `CODEOWL_MOCK_RUNTIME_LOG` | Path to log file for recording mock runtime interactions (development) |

The `apiBaseUrl` config field can point to any OpenAI-compatible gateway endpoint.

## Local GitHub PR Review

To run `codeowl pr-review --github` locally, set:

- `GITHUB_TOKEN`
- `GITHUB_REPOSITORY` in `owner/repo` format
- `PR_NUMBER`

Quick smoke check after install:

```bash
npm run build
npm run test:unit
node dist/index.js --version
codeowl doctor
codeowl audit --reviewers code-quality
```

## Version & Upgrade

```bash
codeowl --version        # Check installed version
npm install -g codeowl@latest   # Upgrade to latest
```

## Troubleshooting

**API key not found**
- Verify `CODE_OWL_LLM_MODEL_API_KEY` is set in your environment
- For Vercel models, set `VERCEL_OIDC_TOKEN` instead
- Run `codeowl doctor` to validate your config and credentials

**Model not available / request failed**
- Run `codeowl models` to list available models for your provider
- Confirm the `model` field in `.codeowl/config.json` uses `provider/model-id` format
- Check network connectivity; some providers may have rate limits

**No reviewers found**
- Built-in reviewers load automatically — if missing, verify the npm package is correctly installed
- Custom reviewers must live in `.codeowl/reviewers/*.md` and include valid frontmatter

**OpenCode runtime unavailable**
- `audit` and `pr-review` expect the bundled OpenCode runtime from the CodeOwl install
- Reinstall dependencies with `npm ci`, `npm install`, or reinstall the global `codeowl` package
- A separate global `opencode` install is optional and only used as a fallback

**Config validation errors**
- Run `codeowl doctor` for a full config check
- Validate your `.codeowl/config.json` against the schema at `node_modules/codeowl/schemas/codeowl-config.schema.json`

## Local Development

```bash
npm run build       # Compile TypeScript + copy templates
npm run dev         # Run the CLI from source via ts-node (no watch; re-run after changes)
node dist/index.js  # Run directly
npm link            # Install as global `codeowl` command
npm run test:unit   # Fast verification for source changes
npm run test        # Unit + integration tests
```

### Mock Runtime

For integration tests and offline development, CodeOwl includes a fixture-based mock runtime that replays pre-recorded AI responses without making live API calls.

| Variable | Description |
|---|---|
| `CODEOWL_RUNTIME=mock` | Switch to the mock runtime |
| `CODEOWL_MOCK_RUNTIME_FIXTURES` | Path to the JSON fixtures file (required when `CODEOWL_RUNTIME=mock`) |
| `CODEOWL_MOCK_RUNTIME_LOG` | Optional path to log recorded interactions for fixture generation |

