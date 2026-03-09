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

```bash
# Install dependencies
npm install

# Build
npm run build

# Link for local development
npm link

# Set your API key
export ANTHROPIC_API_KEY=your-key   # or OPENAI_API_KEY etc.

# Initialize in your target repo
cd /path/to/your/project
codeowl init
codeowl doctor
codeowl audit
```

## Configuration

`.codeowl/config.json`:

```json
{
  "$schema": "./node_modules/codeowl/schemas/codeowl-config.schema.json",
  "model": "anthropic/claude-sonnet-4-5",
  "lightModel": "anthropic/claude-haiku-4-5-20251001",
  "apiKeyEnv": "ANTHROPIC_API_KEY",
  "exclude": ["generated", "vendor"]
}
```

## Reviewers

Built-in reviewers: `security-api`, `code-quality`, `documentation`

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

## Supported Providers

| Provider | Model format | API key env |
|----------|-------------|-------------|
| Anthropic | `anthropic/claude-*` | `ANTHROPIC_API_KEY` |
| OpenAI | `openai/gpt-*` | `OPENAI_API_KEY` |
| OpenRouter | `openrouter/...` | `OPENROUTER_API_KEY` |
| Google | `google/gemini-*` | `GOOGLE_API_KEY` |

## Local Development

```bash
npm run build       # Compile TypeScript + copy templates
node dist/index.js  # Run directly
npm link            # Install as global `codeowl` command
```
