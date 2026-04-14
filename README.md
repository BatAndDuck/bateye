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
bateye conf --model vercel/openai/gpt-5.4-nano --apikey <your-key>

# Run a full repo audit
bateye audit

# Review your current diff
bateye pr-review
```

Prefer environment variables?
- `BATEYE_LLM_MODEL_API_KEY=<your-key>` works too.
- `AI_GATEWAY_API_KEY=<your-key>` or `VERCEL_OIDC_TOKEN=<token>` also work for Vercel-routed models.

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

```bash
bateye pr-review
bateye pr-review --base main --head HEAD
bateye pr-review --github --pr-number 42
```

### Custom reviewers

Drop Markdown reviewer prompts into `.bateye/reviewers/` to add new reviewers or override built-ins. Because every team has at least one very specific opinion.

## Bring your own model

BatEye's structured and Codebite-backed review flows currently support only OpenAI, Anthropic, Google, Mistral, and Vercel AI Gateway through the Vercel AI SDK.

```bash
bateye conf --model vercel/openai/gpt-5.4-nano --apikey <key>
bateye conf --model anthropic/claude-sonnet-4-5 --apikey <key>
bateye conf --model google/gemini-2.5-pro --apikey <key>
bateye conf --model mistral/mistral-large-latest --apikey <key>
```

Provider setup details live here: [Providers](./docs/providers.md)

## Documentation

Start here if you want specifics instead of vibes:

| I want to... | Read |
|---|---|
| Pick a model or provider | [Providers](./docs/providers.md) |
| Configure BatEye | [Configuration](./docs/configuration.md) |
| Run PR review in CI | [GitHub Actions](./docs/github-actions.md) |
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
