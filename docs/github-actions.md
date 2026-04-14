# GitHub Actions - Automated PR Review

BatEye can review pull requests and post inline comments directly to GitHub. Choose how you want to trigger it.

## Setup (5 minutes)

### 1. Copy the workflow file

```bash
mkdir -p .github/workflows
curl -o .github/workflows/bateye-pr-review.yml \
  https://raw.githubusercontent.com/BatAndDuck/bateye/main/.github/workflows/bateye-pr-review.yml
git add .github/workflows/bateye-pr-review.yml
git commit -m "ci: add BatEye PR review workflow"
```

### 2. Add your API key as a GitHub secret

Go to **Settings → Secrets and variables → Actions → New repository secret** and add:

| Secret name | Value |
|---|---|
| `BATEYE_LLM_MODEL_API_KEY` | Your BatEye review credential (for example OpenAI, Anthropic, Google, Mistral, or Vercel AI Gateway) |

Optionally add a fallback key:

| Secret name | Value |
|---|---|
| `BATEYE_LLM_MODEL_API_KEY_FALLBACK` | Secondary API key for failover |

> **Note:** The workflow reads `BATEYE_LLM_MODEL_API_KEY` and `BATEYE_LLM_MODEL_API_KEY_FALLBACK` - not provider-specific names like `ANTHROPIC_API_KEY`.

### 3. That's it

Trigger a review using whichever method fits your team (see below). BatEye will:
- Post a status comment ("BatEye is reviewing…")
- Add inline comments on specific lines with findings
- Update the status comment with a summary when done
- Optionally auto-approve the PR if no significant issues are found

---

## Trigger options

Choose one or combine them by editing the `on:` section of the workflow file.

### Option A - On-demand with `/review` (default)

Post `/review` in any PR comment to kick off a review. No review runs until you ask for one, keeping CI minutes low and giving you full control.

```yaml
on:
  issue_comment:
    types: [created]
```

Usage: post `/review` as a PR comment.

This is the default in the shipped workflow file.

### Option B - Automatically on every PR push

Review every commit pushed to a pull request branch, without any manual trigger.

```yaml
on:
  pull_request:
    types: [opened, synchronize, reopened]
```

Good for teams that want consistent coverage without remembering to trigger it. Costs more CI minutes.

### Option C - On a schedule

Run reviews on a schedule - useful for auditing long-lived PRs or draft PRs that don't get actively pushed.

```yaml
on:
  schedule:
    - cron: '0 9 * * 1-5'   # 9am UTC, Mon–Fri
  pull_request:
    types: [opened]          # also trigger on new PRs
```

### Option D - Combine triggers

```yaml
on:
  pull_request:
    types: [opened, reopened]   # auto-review on open
  issue_comment:
    types: [created]            # re-review on /review comment
```

---

## Required permissions

The workflow uses the built-in `GITHUB_TOKEN` - no personal access token needed:

```yaml
permissions:
  contents: read
  pull-requests: write
```

For auto-approve to work, also enable:
**Settings → Actions → General → "Allow GitHub Actions to create and approve pull requests"**

---

## Customising the model or reviewers

Commit a `.bateye/config.json` to your repo root and the workflow picks it up automatically:

```json
{
  "model": "vercel/openai/gpt-5.4-nano",
  "exclude": ["generated", "vendor"],
  "disabledReviewers": {
    "prReview": ["inline-docs", "responsiveness"]
  }
}
```

See [Configuration](./configuration.md) for all available fields.

---

## Auto-approve

BatEye can automatically approve PRs when no findings exceed a configured severity threshold:

```json
{
  "prReview": {
    "autoApprove": {
      "enabled": true,
      "maxSeverity": "low"
    }
  }
}
```

When a breaking-change finding is detected, auto-approve is disabled for that PR regardless of this setting.

---

## Artifacts

Every run uploads prompt logs as a GitHub Actions artifact:

```
bateye-prompt-logs-<pr-number>-<run-attempt>
```

Find them under **Actions → the workflow run → Artifacts**. Useful for debugging or understanding what the AI saw.

---

## Workflow internals

The workflow:
1. Checks out the PR's head commit (full history for `git diff`)
2. Installs dependencies, verifies the bundled Codebite runtime, and runs lint + tests
3. Links BatEye globally from source (so the exact PR code is tested)
4. Creates a minimal `.bateye/config.json` if none exists in the repo
5. Runs `bateye pr-review --github --pr-number <N>`

The review itself:
1. Parses the unified diff into structured per-line format
2. Runs each reviewer (up to 10 concurrently) through the Codebite-backed agentic runtime
3. Deduplicates findings across reviewers
4. Posts inline comments and a summary to the PR
