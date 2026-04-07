# 🦇 BatEye

**Free, open-source AI code auditor and PR reviewer.** BatEye sends a squad of specialized AI agents through your codebase - each one echolocating a different class of problem - then delivers a structured report with severity scores, file references, and actionable fixes.

> Why a squad instead of just asking your AI coding assistant? A single AI conversation misses things. BatEye runs parallel, purpose-built reviewers - security, complexity, test coverage, docs, validation, and more - each one deeply focused on its domain. You get coverage that a general chat session simply can't match.

---

Run an audit. Walk into your boss's office. *"Found 47 issues. Fixed them all. Saved us $30k in external audit fees."* Promotion secured. 🦇

---

## Install

```bash
npm install -g bateye
```

Free and open source (AGPL-3.0). Use your own models - **Ollama, LM Studio, or any local/cloud provider** - to keep costs lower. [See providers →](./docs/providers.md)

**Requires Node.js 18+**

---

## Quick start

```bash
# 1. Get an API key from your chosen provider (Anthropic, OpenAI, OpenRouter, etc.)
export BATEYE_LLM_MODEL_API_KEY=your-key

# 2. Initialize in your repo
cd your-project
bateye init

# 3. Set the model for your provider
#    The default model requires the Vercel AI Gateway - pick one that matches your key:
bateye conf --model anthropic/claude-sonnet-4-5   # Anthropic key
bateye conf --model openai/gpt-4o                 # OpenAI key
bateye conf --model openrouter/meta-llama/llama-3.3-70b-instruct  # OpenRouter key
bateye conf --model ollama/llama3.2               # Local Ollama (no key needed)
#    → See all supported models: bateye models

# 4. Audit your codebase
bateye audit

# 5. Review your latest changes
bateye pr-review
```

Audit results → `.bateye/out/audit.json` · PR review results → `.bateye/out/pr-review.json` 🦇

---

## Two modes, one tool

### `bateye audit` - full codebase scan

Deploys all reviewers across your entire codebase. Use it before releases, after refactors, or when you inherit a new repo and need to know where the bodies are buried.

```bash
bateye audit                             # Every reviewer, whole codebase
bateye audit --reviewers security-api    # One reviewer only
bateye audit --output ./report.json      # Custom output path
```

### `bateye pr-review` - diff-focused review

Focuses reviewers on the diff only - what changed, what broke, what was missed. Run it locally or wire it into GitHub Actions so every PR gets reviewed automatically.

```bash
bateye pr-review                         # Local diff (origin/main...HEAD)
bateye pr-review --base main --head HEAD
bateye pr-review --github --pr-number 42 # Post inline comments to a GitHub PR
```

→ [GitHub Actions setup](./docs/github-actions.md) - trigger on `/review` comment, on every push, or on a schedule.

**Reduce PR review waiting time.** Enable auto-approve and BatEye will approve the PR automatically when no significant issues are found - your team stops waiting on a human for straightforward changes:

```json
{
  "prReview": {
    "autoApprove": { "enabled": true, "maxSeverity": "low" }
  }
}
```

---

## Configuration

All behaviour is controlled by `.bateye/config.json` in your repo root. `bateye init` creates it, `bateye config set` edits it, and `bateye conf` is the quickest way to change the active model or store a repo-scoped API key:

```json
{
  "model": "anthropic/claude-sonnet-4-5",
  "exclude": ["generated", "migrations"],
  "disabledReviewers": {
    "audit": ["accessibility"],
    "prReview": ["inline-docs"]
  }
}
```

Quick model/key setup:

```bash
bateye conf --model openai/gpt-5.4-nano --apikey <your-key>
```

`bateye conf --apikey` stores the key in `~/.bateye/credentials.json` with restrictive local file permissions. It is not encrypted, so prefer environment variables or short-lived keys on shared machines.

If you are using an OpenAI-compatible gateway instead of api.openai.com, set `apiBaseUrl` to that gateway's `/v1` base. For Azure AI Foundry, use your resource endpoint with `/openai` in config and BatEye will normalize the OpenCode review path to `/openai/v1`.

Pick a model, exclude noisy paths, disable reviewers that don't apply to your stack. [Full config reference →](./docs/configuration.md)

---

## How it works

BatEye runs parallel, purpose-built AI reviewers - not a single chat prompt, but a coordinated squad:

| Reviewer | Looks for |
|---|---|
| `security-api` | Injection flaws, secrets exposure, auth gaps |
| `code-quality` | Smells, complexity, maintainability |
| `test-coverage` | Missing tests, edge cases, brittle assertions |
| `documentation` | Missing docs, stale comments |
| `complexity` | Overly complex logic, refactor candidates |
| `input-validation` | Unvalidated inputs, type coercions |
| ...and more | [Full catalog →](./docs/reviewers.md) |

Each reviewer investigates independently. BatEye deduplicates and synthesizes findings into one report.

**You can also write your own reviewers** - drop a `.md` file with a prompt into `.bateye/reviewers/` and BatEye picks it up automatically. Override any built-in reviewer or add completely new ones. [Custom reviewers →](./docs/reviewers.md#custom-reviewers)

---

## Supported providers

Use any AI provider - just set `BATEYE_LLM_MODEL_API_KEY` and pick a model:

```bash
bateye config set model anthropic/claude-sonnet-4-5
bateye config set model openai/gpt-4o
bateye config set model ollama/llama3.2                                    # local, free
bateye config set model openrouter/meta-llama/llama-3.3-70b-instruct
bateye config set model groq/llama-3.3-70b-versatile
```

**LiteLLM proxy / custom gateway** — point BatEye at any OpenAI-compatible endpoint:

```bash
# LiteLLM on localhost:4000 (default)
bateye conf --model litellm/gpt-4o --apikey sk-your-litellm-key

# Remote or non-default host — set apiBaseUrl and use the model name your proxy exposes:
bateye config set apiBaseUrl https://your-host/v1
bateye conf --model litellm/gpt-4o --apikey sk-your-key
```

**Azure AI Foundry / Azure OpenAI compatible endpoint**:

```bash
export BATEYE_LLM_MODEL_API_KEY=<your-azure-key>

# Use the deployment name after the provider prefix.
bateye conf --model azure/gpt-5.4-nano

# Set your Azure endpoint root with /openai.
# BatEye uses the correct OpenAI-compatible /openai/v1 path for agentic reviews.
bateye config set apiBaseUrl https://<resource>.cognitiveservices.azure.com/openai
```

Anthropic · OpenAI · OpenRouter · Google · DeepSeek · Groq · Cerebras · Azure · **LiteLLM proxy** · **Ollama (local, free)** · **LM Studio (local, free)** · Vercel AI Gateway · [20+ providers →](./docs/providers.md)

---

## Other commands

```bash
bateye init                              # Set up .bateye/ in your repo
bateye doctor                            # Verify config, API key, reviewers
bateye models                            # List models for current provider
bateye models openai                     # List models for a specific provider
bateye models --all                      # List all providers (slow)
bateye conf --model <model> --apikey <key> # Set model and store a repo API key
bateye reviewers                         # List all reviewers (built-in + custom)
bateye config show                       # Show current config
```

---

## Going further

| Topic | Doc |
|---|---|
| Config fields, schema, model selection | [Configuration](./docs/configuration.md) |
| Built-in reviewers, writing custom reviewers | [Reviewers](./docs/reviewers.md) |
| GitHub Actions - PR review triggers & setup | [GitHub Actions](./docs/github-actions.md) |
| All supported providers + model formats | [Providers](./docs/providers.md) |
| API keys, environment variables | [Configuration → Environment variables](./docs/configuration.md#environment-variables) |
| Something broken | [Troubleshooting](./docs/troubleshooting.md) |

---

## Local development

```bash
npm ci
npm run build
npm run link:local       # builds + installs as global `bateye`

npm run test:unit        # fast unit tests
npm run test             # unit + integration
```

Copy `.env.example` to `.env` and fill in your keys for local runs.
