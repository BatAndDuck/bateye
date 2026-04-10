# Benchmark Analysis Prompt

Use this prompt with the contents of a `*_benchmark.md` file to get a structured analysis of how well the AI reviewer performed against the controlled issue set.

---

## Prompt

Below is the output of an AI code review run against a fake PR with 35 deliberately introduced issues. Your job is to analyze the findings and produce a structured report.

### Known Issues Table

The PR contains the following 35 intentional issues:

**Security (5)**

| # | File | Issue | Difficulty | Reviewer Tags |
|---|------|-------|------------|---------------|
| 1 | platform.ts | GitHub token prefix logged in console.warn error messages | Easy | secrets, security-api |
| 2 | config-service.ts | Raw config file contents exposed in parse error message | Easy | secrets, owasp |
| 3 | config-service.ts | Resolved API key written back to process.env globally | Hard | secrets, security-api |
| 4 | provider-routing.ts | .env file now has higher priority than process.env | Hard | security-api, other-security-issues |
| 5 | provider-routing.ts | SSRF protection removed — URL scheme no longer validated | Medium | owasp, input-validation |

**Bug — Critical (5)**

| # | File | Issue | Difficulty | Reviewer Tags |
|---|------|-------|------------|---------------|
| 6 | deduplicator.ts | keepPrimary condition inverted — dedup keeps the lower severity finding | Hard | bug-hunter, clean-code |
| 7 | config-service.ts | setConfigField discards loaded config — all other settings wiped on any field update | Easy | bug-hunter, error-handling |
| 8 | validation/schemas.ts | endLine validation inverted — all multi-line findings rejected | Hard | bug-hunter, test-coverage |
| 9 | audit-service.ts | Off-by-one in runReviewersWithConcurrency — processes items[length] (undefined) | Hard | bug-hunter, concurrency |
| 10 | diff-parser.ts | Hunk boundary uses '@@ ' without \n — mid-content matches corrupt hunk parsing | Hard | bug-hunter |

**Bug — High (8)**

| # | File | Issue | Difficulty | Reviewer Tags |
|---|------|-------|------------|---------------|
| 11 | provider-routing.ts | Model routing logic inverted — wrong model ID format sent to non-native transports | Hard | bug-hunter, api-contract |
| 12 | deduplicator.ts | codeQuoteOverlaps uses !includes — almost any two distinct quotes are "overlapping" | Hard | bug-hunter, clean-code |
| 13 | audit-service.ts | linesOverlap subtracts tolerance instead of adding — near findings not deduplicated | Hard | bug-hunter |
| 14 | audit-service.ts | SCORE_THRESHOLDS in ascending order — find() always returns "Significant issues" | Medium | bug-hunter, complexity |
| 15 | conversation.ts | Exact file+line match returns true — already-posted findings never filtered | Easy | bug-hunter |
| 16 | platform.ts | Regex ValidationFailed (no space) never matches GitHub's "Validation Failed" — fallback never triggered | Medium | bug-hunter, error-handling |
| 17 | platform.ts | updateOrCreateBreakingChangesComment uses wrong marker — overwrites PR summary | Medium | bug-hunter |
| 18 | diff-parser.ts | Context lines report newLineNumber - 1 — AI-generated findings reference wrong lines | Medium | bug-hunter, ai-safety |

**Breaking Changes (4)**

| # | File | Issue | Difficulty | Reviewer Tags |
|---|------|-------|------------|---------------|
| 19 | audit-service.ts | CONFIDENCE_FLOORS.critical lowered 0.75 → 0.25 — low-confidence critical findings flood reports | Medium | breaking-change, bug-hunter |
| 20 | pipeline.ts | CONFIDENCE_FLOORS.critical set to 0.50 — inconsistent with audit's 0.25 | Medium | breaking-change, clean-code |
| 21 | platform.ts | approvePR removed try-catch — approval failures abort entire PR review | Medium | breaking-change, error-handling, resiliency |
| 22 | reviewer-registry.ts | enabled !== false filter removed — disabled reviewers are always loaded | Easy | breaking-change, bug-hunter |

**Scalability / Performance (3)**

| # | File | Issue | Difficulty | Reviewer Tags |
|---|------|-------|------------|---------------|
| 23 | defaults.ts | MAX_CONCURRENT_PR_REVIEWERS 6 → 25 — no rate limiting, hammers the AI API | Medium | scalability, resilience-patterns |
| 24 | defaults.ts | MAX_AUDIT_REVIEWER_TOKENS 8096 → 800 — truncated AI responses | Medium | scalability, llm-cost |
| 25 | audit-service.ts | packageAppearsInSource reads all files synchronously — full-repo scan during review | Medium | scalability, algorithmic-complexity |

**AI Safety (1)**

| # | File | Issue | Difficulty | Reviewer Tags |
|---|------|-------|------------|---------------|
| 26 | diff-parser.ts | Context lines have wrong line numbers — AI findings shift by -1 | Medium | ai-safety, bug-hunter |

**Error Handling / Resiliency (4)**

| # | File | Issue | Difficulty | Reviewer Tags |
|---|------|-------|------------|---------------|
| 27 | config-service.ts | Empty string transport allowed — silent routing failures downstream | Medium | error-handling, bug-hunter |
| 28 | audit-service.ts | tokenize no longer strips special chars — foo-bar stays one token, corrupts Jaccard | Medium | clean-code, bug-hunter |
| 29 | verifier.ts | verifyFindings returns unvalidated finding instead of parsed.data — Zod coercions ignored | Medium | error-handling, bug-hunter |
| 30 | platform.ts | listReviewComments no longer paginates — inline comments beyond page 1 not fetched | Medium | resiliency, bug-hunter |

**Concurrency (1)**

| # | File | Issue | Difficulty | Reviewer Tags |
|---|------|-------|------------|---------------|
| 31 | audit-service.ts | Off-by-one > instead of >= allows extra worker iteration on undefined item | Hard | concurrency, bug-hunter |

**Scoring / Quality (4)**

| # | File | Issue | Difficulty | Reviewer Tags |
|---|------|-------|------------|---------------|
| 32 | normalizer.ts | Math.min → Math.max for penalty — minimum 20-point penalty on every repo, max score is 80 | Medium | bug-hunter, clean-code |
| 33 | verifier.ts | collectVerificationTrailFiles uses path.resolve instead of path.join(repoPath, ...) | Medium | bug-hunter, error-handling |
| 34 | validation/schemas.ts | startLine/endLine min changed 1 → 0 — line 0 references accepted, off-by-one findings pass | Medium | bug-hunter, test-coverage |
| 35 | deduplicator.ts | LINE_OVERLAP_FRACTION_THRESHOLD 0.9 → 0.09 — 9% range overlap triggers deduplication | Medium | bug-hunter, simplicity |

---

### AI Review Findings

Paste the full contents of the benchmark `.md` file here:

```
[PASTE BENCHMARK OUTPUT HERE]
```

---

### Analysis Tasks

Please analyze the above and produce the following report:

**1. Detection Rate**

How many of the 35 known issues were found and reported by the AI reviewer? Provide a count and percentage.

**2. Per-Issue Status Table**

For each of the 35 issues in the table above, indicate whether it was found:

| # | File | Issue (short) | Found? | Finding Title (if found) |
|---|------|---------------|--------|--------------------------|
| 1 | platform.ts | Token prefix logged | ✅ / ❌ | ... |
| ... | | | | |

Use ✅ for found, ❌ for not found. A finding counts as "found" if the AI reviewer reported something that clearly matches the issue (same file, similar location, same root problem) — even if the wording differs.

**3. False Positives**

List all findings that do NOT correspond to any of the 35 known issues. For each:
- Finding title
- File and line
- Why it is a false positive (or why it might be a genuine issue that wasn't in the list)

Provide a count.

**4. Unlisted Real Issues**

Are there any findings that were NOT in the 35-issue list, but appear to be genuine bugs or security problems worth keeping? List them separately from false positives.

**5. Summary Statistics**

| Metric | Value |
|--------|-------|
| Total known issues | 35 |
| Issues found | ? |
| Issues missed | ? |
| Detection rate | ?% |
| False positives | ? |
| Unlisted real issues | ? |
| Total findings reported | ? |

**6. Difficulty Breakdown**

Of the found issues, how many were Easy / Medium / Hard? Did the model struggle more with hard issues?

| Difficulty | Total in PR | Found | Missed | Detection Rate |
|------------|-------------|-------|--------|----------------|
| Easy | 8 | ? | ? | ?% |
| Medium | 18 | ? | ? | ?% |
| Hard | 9 | ? | ? | ?% |

**7. Category Breakdown**

| Category | Total | Found | Detection Rate |
|----------|-------|-------|----------------|
| Security | 5 | ? | ?% |
| Bug — Critical | 5 | ? | ?% |
| Bug — High | 8 | ? | ?% |
| Breaking Changes | 4 | ? | ?% |
| Scalability | 3 | ? | ?% |
| AI Safety | 1 | ? | ?% |
| Error Handling | 4 | ? | ?% |
| Concurrency | 1 | ? | ?% |
| Scoring / Quality | 4 | ? | ?% |
