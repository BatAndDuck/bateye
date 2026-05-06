# BatEye

BatEye is a CLI for AI code review on pull requests and whole repositories.

You point it at a repo, choose a model, and it sends a squad of specialist reviewers after the code. Think less "one giant prompt" and more "a few suspicious teammates who never get tired."

BatEye is useful when you want to:
- audit a repo before a release
- review a diff locally before opening a PR
- run AI review in GitHub Actions
- use your own supported provider instead of a SaaS-only tool

## Install

```bash
npm install -g bateye
```

Node.js 18+ required.

## 60-second setup

```bash
cd your-project
bateye init

# Pick a model and key
bateye conf --model openai/gpt-5.4-nano --apikey <your-key>

# Run a full repo audit
bateye audit

# Review your current diff
bateye pr-review
```

Prefer environment variables?
- `BATEYE_LLM_MODEL_API_KEY=<your-key>` works for direct provider models such as `openai/gpt-5.4-nano`.
- `AI_GATEWAY_API_KEY=<your-key>` or `VERCEL_OIDC_TOKEN=<token>` are required for Vercel-routed models such as `vercel/openai/gpt-5.4-nano`.

BatEye writes results to `.bateye/out/`. Use `.bateye/config.local.json` for local-only overrides you do not want to commit, including optional `apiKey` and `githubToken` fields.

## Two jobs, one bat

### `bateye audit`

Full-repo scan across security, code quality, tests, docs, complexity, input validation, and more.

```bash
bateye audit
bateye audit --reviewers security-api
bateye audit --output ./report.json
```

### `bateye pr-review`

Diff-focused review for the changes you are actually about to merge.

`pr-review` now runs in two stages:
- one deep Codebite planner run (`codebite@0.5.0`, deep mode, `maxSteps=150`) that investigates the full change context and prepares reviewer-specific briefings
- bounded reviewer runs (`maxSteps=20`, non-deep) that start from those briefings instead of rediscovering the repo from scratch

```bash
bateye pr-review
bateye pr-review --base main --head HEAD
bateye pr-review --github --pr-number 42
```

### Custom reviewers

Drop Markdown reviewer prompts into `.bateye/reviewers/` to add new reviewers or override built-ins. Because every team has at least one very specific opinion.

## Bring your own model

BatEye's structured and Codebite-backed review flows support the full current Codebite provider set through the Vercel AI SDK: OpenAI, Anthropic, Google, Mistral, Vercel AI Gateway, Groq, xAI, Cohere, DeepSeek, AWS Bedrock, Azure OpenAI, Together AI, Fireworks AI, and LiteLLM.

```bash
bateye conf --model openai/gpt-5.4-nano --apikey <key>
bateye conf --model vercel/openai/gpt-5.4-nano --apikey <ai-gateway-key>
bateye conf --model anthropic/claude-sonnet-4-5 --apikey <key>
bateye conf --model google/gemini-2.5-pro --apikey <key>
bateye conf --model mistral/mistral-large-latest --apikey <key>
bateye conf --model groq/llama-3.3-70b-versatile --apikey <key>
bateye conf --model deepseek/deepseek-chat --apikey <key>
bateye conf --model litellm/ollama/llama3 --apikey none
```

Provider setup details live here: [Providers](./docs/providers.md)

## Documentation

Start here if you want specifics instead of vibes:

| I want to... | Read |
|---|---|
| Pick a model or provider | [Providers](./docs/providers.md) |
| Configure BatEye | [Configuration](./docs/configuration.md) |
| Run PR review in CI | [GitHub Actions](./docs/github-actions.md) |
| Benchmark planner-backed PR review | [Benchmark README](./.bateye/benchmark/README.md) |
| See built-in reviewers or write my own | [Reviewers](./docs/reviewers.md) |
| Fix a broken setup | [Troubleshooting](./docs/troubleshooting.md) |
| Browse the docs map | [Docs index](./docs/README.md) |

## Why BatEye?

- More than one reviewer: findings come from specialized prompts, not a single all-purpose chat.
- Local or hosted: use the model that fits your budget, privacy, and patience.
- Repo-aware configuration: tune reviewers, excluded paths, and model choices per repository.
- CI-friendly: run locally first, then wire it into GitHub Actions.

## Local development

```bash
npm ci
npm run build
npm run lint
npm test
npm run link:local
```

## Contributing and security

- [Contributing guide](./CONTRIBUTING.md)
- [Security policy](./SECURITY.md)
- [Changelog](./CHANGELOG.md)

## License

AGPL-3.0

If BatEye catches something embarrassing before production, the bat accepts tips in the form of stars.
