# 🦇 BatEye

**Free, open-source AI code auditor and PR reviewer.** BatEye sends a squad of specialized AI agents through your codebase — each one echolocating a different class of problem — then delivers a structured report with severity scores, file references, and actionable fixes.

> Why a squad instead of just asking your AI coding assistant? A single AI conversation misses things. BatEye runs parallel, purpose-built reviewers — security, complexity, test coverage, docs, validation, and more — each one deeply focused on its domain. You get coverage that a general chat session simply can't match.

---

Run an audit. Walk into your boss's office. *"Found 47 issues. Fixed them all. Saved us $30k in external audit fees."* Promotion secured. 🦇

---

## Install

```bash
npm install -g bateye
```

Free and open source (AGPL-3.0). Use your own models — **Ollama, LM Studio, or any local/cloud provider** — to keep costs lower. [See providers →](./docs/providers.md)

**Requires Node.js 18+**

---

## Quick start

```bash
# 1. Get an API key (Anthropic, OpenAI, OpenRouter, etc.) — or use a local model
export BATEYE_LLM_MODEL_API_KEY=your-key

# 2. Initialize in your repo
cd your-project
bateye init

# 3. Audit your codebase
bateye audit

# 4. Review your latest changes
bateye pr-review
```

Audit results → `.bateye/out/audit.json` · PR review results → `.bateye/out/pr-review.json` 🦇

---

## Two modes, one tool

### `bateye audit` — full codebase scan

Deploys all reviewers across your entire codebase. Use it before releases, after refactors, or when you inherit a new repo and need to know where the bodies are buried.

```bash
bateye audit                             # Every reviewer, whole codebase
bateye audit --reviewers security-api    # One reviewer only
bateye audit --output ./report.json      # Custom output path
```

### `bateye pr-review` — diff-focused review

Focuses reviewers on the diff only — what changed, what broke, what was missed. Run it locally or wire it into GitHub Actions so every PR gets reviewed automatically.

```bash
bateye pr-review                         # Local diff (origin/main...HEAD)
bateye pr-review --base main --head HEAD
bateye pr-review --github --pr-number 42 # Post inline comments to a GitHub PR
```

→ [GitHub Actions setup](./docs/github-actions.md) — trigger on `/review` comment, on every push, or on a schedule.

**Reduce PR review waiting time.** Enable auto-approve and BatEye will approve the PR automatically when no significant issues are found — your team stops waiting on a human for straightforward changes:

```json
{
  "prReview": {
    "autoApprove": { "enabled": true, "maxSeverity": "low" }
  }
}
```

---

## Configuration

All behaviour is controlled by `.bateye/config.json` in your repo root. `bateye init` creates it, `bateye config set` edits it:

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

Pick a model, exclude noisy paths, disable reviewers that don't apply to your stack. [Full config reference →](./docs/configuration.md)

---

## How it works

BatEye runs parallel, purpose-built AI reviewers — not a single chat prompt, but a coordinated squad:

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

**You can also write your own reviewers** — drop a `.md` file with a prompt into `.bateye/reviewers/` and BatEye picks it up automatically. Override any built-in reviewer or add completely new ones. [Custom reviewers →](./docs/reviewers.md#custom-reviewers)

---

## Supported providers

Use any AI provider — just set `BATEYE_LLM_MODEL_API_KEY` and pick a model:

```bash
bateye config set model anthropic/claude-sonnet-4-5
bateye config set model openai/gpt-4o
bateye config set model ollama/llama3.2        # local, free
bateye config set model openrouter/meta-llama/llama-3.3-70b-instruct
```

Anthropic · OpenAI · OpenRouter · Google · DeepSeek · Groq · Cerebras · Azure · **Ollama (local, free)** · **LM Studio (local, free)** · Vercel AI Gateway · [20+ providers →](./docs/providers.md)

---

## Other commands

```bash
bateye init                              # Set up .bateye/ in your repo
bateye doctor                            # Verify config, API key, reviewers
bateye models                            # List available AI models
bateye reviewers                         # List all reviewers (built-in + custom)
bateye config show                       # Show current config
```

---

## Going further

| Topic | Doc |
|---|---|
| Config fields, schema, model selection | [Configuration](./docs/configuration.md) |
| Built-in reviewers, writing custom reviewers | [Reviewers](./docs/reviewers.md) |
| GitHub Actions — PR review triggers & setup | [GitHub Actions](./docs/github-actions.md) |
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
