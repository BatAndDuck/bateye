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
- Built-in reviewers load automatically from the BatEye install — if missing, reinstall: `npm install -g bateye`
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
   bateye config set model groq/llama-3.3-70b-versatile
   ```

4. **Check the output for partial results** — `.bateye/out/audit.json` may have partial data even if the CLI didn't exit cleanly.

---

## GitHub Actions: workflow fails immediately

**Symptom:** `Error: BATEYE_LLM_MODEL_API_KEY is not set` in GitHub Actions

**Fix:** Add the secret in GitHub:
- **Settings → Secrets and variables → Actions → New repository secret**
- Name: `BATEYE_LLM_MODEL_API_KEY`
- Value: your AI provider API key

The workflow reads `BATEYE_LLM_MODEL_API_KEY` — not provider-specific names like `ANTHROPIC_API_KEY`.

---

## GitHub Actions: no comments posted

**Symptom:** Workflow completes but no PR comments appear

**Check:**
1. Workflow has `pull-requests: write` permission
2. `GITHUB_TOKEN` has write access (check repo Settings → Actions → General)
3. Look at the workflow run logs for errors in the "Run BatEye PR Review" step
4. Check `.bateye/out/pr-review.json` artifact for findings data

---

## OpenCode runtime unavailable

**Symptom:** `Cannot find OpenCode runtime` or similar

**Fix:**
```bash
npm install -g bateye   # reinstall
bateye doctor
```

BatEye bundles the OpenCode runtime — no separate `npm install -g opencode-ai` needed. A global `opencode` install is only used as a fallback.

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

Open an issue: https://github.com/CodeNinjaArea/BatEye/issues

Include:
- Output of `bateye doctor`
- Your `.bateye/config.json` (redact API keys)
- The exact command you ran and the error output
