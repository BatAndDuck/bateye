# Troubleshooting

## Quick check

Before digging in, run:

```bash
bateye doctor
```

This validates your config, API key, and reviewer setup and tells you exactly what's wrong.

---

## API key not found

**Symptom:** `Error: API key not set` or similar

**Fix:**
```bash
export BATEYE_LLM_MODEL_API_KEY=your-api-key
bateye doctor
```

For Vercel AI Gateway models, use `VERCEL_OIDC_TOKEN` instead:
```bash
export VERCEL_OIDC_TOKEN=your-vercel-oidc-token
```

Check which env var your config expects:
```bash
bateye config show   # shows apiKeyEnv field
```

---

## Model not available / request failed

**Symptom:** `Model not found`, `401 Unauthorized`, or `Request failed`

**Fix:**
1. List available models: `bateye models` or `bateye models <provider>`
2. Confirm the `model` field uses `provider/model-id` format
3. Check your API key has access to the model
4. Check network connectivity and provider rate limits

```bash
bateye config set model anthropic/claude-sonnet-4-5
```

---

## No reviewers found

**Symptom:** `No reviewers found` or `0 reviewers selected`

**Fix:**
- Built-in reviewers load automatically from the BatEye install - if missing, reinstall: `npm install -g bateye`
- Custom reviewers must be in `.bateye/reviewers/*.md` with valid frontmatter (the `id` and `name` fields are required)
- Check `enabled: false` isn't set in your reviewer frontmatter

```bash
bateye reviewers   # lists what BatEye can see
```

---

## Audit hangs or times out

**Symptom:** `bateye audit` runs for a very long time or stalls

**This is a known issue for repos with many files.** Try:

1. **Run fewer reviewers:**
   ```bash
   bateye audit --reviewers security-api,code-quality
   ```

2. **Exclude large directories:**
   ```json
   {
     "exclude": ["generated", "vendor", "migrations", "fixtures"]
   }
   ```

3. **Use a faster model:**
   ```bash
   bateye config set model google/gemini-2.0-flash
   ```

4. **Check the output for partial results** - `.bateye/out/audit.json` may have partial data even if the CLI didn't exit cleanly.

---

## GitHub Actions: workflow fails immediately

**Symptom:** `Error: BATEYE_LLM_MODEL_API_KEY is not set` in GitHub Actions

**Fix:** Add the secret in GitHub:
- **Settings → Secrets and variables → Actions → New repository secret**
- Name: `BATEYE_LLM_MODEL_API_KEY`
- Value: your AI provider API key

The workflow reads `BATEYE_LLM_MODEL_API_KEY` - not provider-specific names like `ANTHROPIC_API_KEY`.

---

## GitHub Actions: no comments posted

**Symptom:** Workflow completes but no PR comments appear

**Check:**
1. Workflow has `pull-requests: write` permission
2. `GITHUB_TOKEN` has write access (check repo Settings → Actions → General)
3. Look at the workflow run logs for errors in the "Run BatEye PR Review" step
4. Check `.bateye/out/pr-review.json` artifact for findings data

---

## Codebite runtime unavailable

**Symptom:** `Codebite runtime is not available` or similar

**Fix:**
```bash
npm install -g bateye   # reinstall
bateye doctor
```

BatEye bundles the Codebite runtime through its normal dependencies. There is no separate global agent CLI to install.

Current PR review uses `codebite@0.5.0`, including deep-mode planner runs and Codebite diagnostics.

---

## PR review finished as DEGRADED with planner-context warnings

**Symptom:** `bateye pr-review` completes, but `.bateye/out/pr-review.json` contains warnings such as `pr-reviewer-planner-context-fallback`

**Meaning:** The deep planner selected a reviewer, but the planner's focused paths were missing, invalid, or too sparse for that reviewer. BatEye fell back to the broader PR context for that reviewer instead of aborting the whole run.

**Fix / next checks:**
1. Re-run with diagnostics enabled:
   ```bash
   bateye --diagnostic pr-review
   ```
2. Inspect `.bateye/out/diagnostics/` for the planner JSONL and rendered `.trace.md` files.
3. Check whether the PR changes moved or renamed files after the planner investigated them.
4. If you use custom reviewers, confirm their `selectWhen` rules are not selecting a domain with no useful nearby paths.

This warning means review coverage degraded for that reviewer, not that BatEye skipped the review entirely.

---

## Benchmark diagnostics are missing

**Symptom:** `scripts/benchmark.ts` ran, but you expected planner/reviewer diagnostics and no diagnostics directory was produced

**Fix:**
```bash
npx ts-node scripts/benchmark.ts --model "openai/gpt-5.4-nano" --pr "https://github.com/BatAndDuck/bateye/pull/20" --diagnostics
```

With `--diagnostics`, the benchmark prints both the benchmark markdown path and the diagnostics directory path. The diagnostics files are written under `.bateye/benchmark/diagnostics/`.

---

## Config validation errors

**Symptom:** `Invalid config` or schema validation errors

**Fix:**
```bash
bateye doctor   # shows exactly which fields are invalid
```

Validate manually against the schema:
```bash
node -e "
const cfg = require('./.bateye/config.json');
console.log(JSON.stringify(cfg, null, 2));
"
```

---

## Still stuck?

Open an issue: https://github.com/BatAndDuck/bateye/issues

Include:
- Output of `bateye doctor`
- Your `.bateye/config.json` (redact API keys)
- The exact command you ran and the error output
