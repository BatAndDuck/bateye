import { BATEYE_SUMMARY_MARKER } from '../config/defaults';
import { PRFinding, ReviewIssue, ReviewRunStatus } from '../../types/index';
import { CommitSummary } from '../git/index';
import { RepoProfile } from './audit';

const DIFF_PREVIEW_MAX_CHARS = 16_000;

export function buildOrchestratorSystemPrompt(availableReviewers: { id: string; name: string; description?: string; selectWhen?: string }[]): string {
  const reviewerList = availableReviewers
    .map(r => {
      let line = `- id: "${r.id}", name: "${r.name}"`;
      if (r.description) line += `, description: "${r.description}"`;
      if (r.selectWhen) line += `\n  selectWhen: "${r.selectWhen}"`;
      return line;
    })
    .join('\n');

  return `You are a PR review orchestrator. Given a pull request diff, changed files, and commit history, select ALL reviewers that are relevant to this PR.

## Available Reviewers
${reviewerList}

## Output Requirements

CRITICAL OUTPUT RULE: Your ENTIRE response must be valid JSON. Start your response with { and end with }. Write NO text before or after the JSON. NO markdown code blocks. NO explanation. NO introduction sentences. If your response contains anything other than the JSON object, the system will crash.

Your response must look exactly like this (replace the example values):
{
  "intentSummary": "This PR introduces prompt logging to CI artifacts (all LLM calls written to .bateye/out/prompts/) and raises the built-in reviewer cap to 20. The removal of the fallback reviewer list is deliberate — errors now propagate to surface real problems rather than silently substituting defaults.",
  "selectedReviewers": [
    {
      "reviewerId": "code-quality",
      "reason": "The diff modifies TypeScript functions and introduces new logic paths that should be reviewed for quality.",
      "confidence": 0.95
    },
    {
      "reviewerId": "error-handling",
      "reason": "The diff introduces async functions and promise chains without consistent error handling.",
      "confidence": 0.85
    }
  ]
}

## intentSummary

Before selecting reviewers, write a concise (2-4 sentence) \`intentSummary\` that captures:
1. What this PR is trying to accomplish (the primary goal).
2. Which changes look deliberate / intentional — e.g., "logging is intentionally verbose for CI diagnostics", "fallback removed on purpose to surface errors", "API signature changed as part of a planned migration".

Reviewers will receive this summary so they can skip findings about deliberate design decisions.

## Selection Rules

- **Select all reviewers that are relevant** — there is no target number. A PR touching many concerns should have many reviewers; a trivial change may need only one.
- **Use the selectWhen field** on each reviewer as the primary guide for whether to include it. If the PR content matches a reviewer's selectWhen condition, include that reviewer.
- For reviewers without a selectWhen field, use their name and description to judge relevance against the changed files and diff content.
- **Err toward inclusion** when in doubt. A reviewer that produces zero findings is harmless; a missed reviewer means missed issues.
- Include reviewers for every concern visible in the diff: code quality, security, error handling, documentation, resilience, logging, tests, CI/CD, etc.
- Exclude a reviewer only when the diff clearly has no overlap with the reviewer's domain (e.g., do not include a database reviewer for a pure UI change).
- Never return an empty array unless the diff contains zero code changes.
- **confidence** (0–1): rate your certainty that this reviewer is relevant. Use ≥ 0.9 when the match is obvious, 0.7–0.89 when probable, 0.5–0.69 when possible. Only include reviewers with confidence ≥ 0.5.

- Return ONLY the JSON`;
}

export function buildOrchestratorUserMessage(changedFiles: string[], diff: string, commits: CommitSummary[]): string {
  const diffPreview = diff.length > DIFF_PREVIEW_MAX_CHARS ? diff.slice(0, DIFF_PREVIEW_MAX_CHARS) + '\n\n[...diff truncated...]' : diff;
  const commitSection = commits.length === 0
    ? '- No additional commits detected between base and head'
    : commits.map(commit => `- ${commit.sha.slice(0, 12)} ${commit.subject}`).join('\n');

  return `## Changed Files
${changedFiles.map(f => `- ${f}`).join('\n')}

## Commits in This PR
${commitSection}

## Diff
\`\`\`diff
${diffPreview}
\`\`\`

Which reviewers should analyze this PR?`;
}

function buildPRRepoProfileSummary(profile: RepoProfile): string {
  const parts: string[] = [];
  const techStack: string[] = [];
  if (profile.hasPackageJson) techStack.push('Node.js / TypeScript / JavaScript');
  if (profile.hasPyProject) techStack.push('Python');
  if (profile.hasGoMod) techStack.push('Go');
  if (techStack.length) parts.push(`Tech stack: ${techStack.join(', ')}`);

  const features: string[] = [];
  if (profile.hasFrontendFiles) features.push('frontend / UI');
  if (profile.hasSqlFiles) features.push('database / SQL');
  if (profile.hasDockerfile) features.push('containerized');
  if (profile.hasAiLibraries) features.push('AI / LLM integration');
  if (features.length) parts.push(`Features: ${features.join(', ')}`);

  if (!profile.hasFrontendFiles && !profile.hasSqlFiles && !profile.hasDockerfile) {
    parts.push('Project type: likely a local CLI tool or developer library.');
  }
  return parts.join('\n') + '\n\nUse this profile to judge whether a finding applies to THIS project.';
}

function buildPRModeOverlay(reviewerId: string): string {
  const commonOverlay = `## PR MODE OVERRIDES

- You are reviewing a pull request, not performing a repo-wide audit.
- Investigate the current repository state before reporting anything.
- Always inspect the changed file in its current post-change state.
- Inspect neighboring files or referenced modules when a claim depends on behavior outside the diff.
- Report only issues that still exist in the current codebase after investigation.
- Do not report "missing", "removed", "no X", or "breaks Y" claims unless you actually inspected the relevant current file(s) and confirmed the problem.
- Prefer zero findings over partially verified concerns.
`;

  if (['ci-cd', 'bug-hunter', 'clean-code'].includes(reviewerId)) {
    return `${commonOverlay}
- Do not infer missing workflow gates, configuration, or helper behavior from a partial patch alone.
- If unchanged lines in the current file contradict the concern, do not report it.
`;
  }

  return commonOverlay;
}

export function buildPRReviewSystemPrompt(
  reviewerInstructions: string,
  reviewerId: string,
  reviewerName: string,
  repoProfile?: RepoProfile,
): string {
  const prefix = reviewerId.toUpperCase().replace(/-/g, '_');
  const profileSection = repoProfile
    ? `\n## Repository Profile\n${buildPRRepoProfileSummary(repoProfile)}\n`
    : '';

  return `You are a precise code reviewer performing a "${reviewerName}" review on a pull request.
${profileSection}
${reviewerInstructions}
${buildPRModeOverlay(reviewerId)}
## HOW TO DO THIS REVIEW — TWO PHASES

### PHASE 1: INVESTIGATE FIRST (form no opinions yet)
0. **Read the "PR INTENT" section in the user message first.** It describes what the author deliberately changed and why. Any concern that matches something described there is NOT a finding — skip it immediately, before any other investigation.
1. Open and read the changed files listed in the diff.
2. Follow imports and references to understand context outside the diff.
3. Use search tools to confirm whether a problem actually exists in the current codebase.
4. For each potential concern, find the EXACT line in the diff that causes the problem.
5. Read the commit messages in this PR. If a commit message or code comment already explains the design decision behind a potential concern, that concern is intentional — do NOT report it.
6. Check adjacent documentation (README.md, AGENTS.md, CLAUDE.md, docs/) to see if the behavior you are about to flag is already described there.

### PHASE 2: DECIDE WHAT TO REPORT (only after investigation)
5. Ask yourself: "Did I read actual code in the diff that proves this problem exists at a specific line?"
6. If "yes" → report it. If "maybe" or "not sure" → do NOT report it.
7. Ask yourself: "Does this concern apply to THIS project type?" (see Repository Profile above). If not → do NOT report it.
8. Zero findings is a VALID and GOOD outcome. Never pad with uncertain concerns.

## STRICT RULES — MUST FOLLOW

1. Use the filesystem/search tools available in your environment to inspect the repository before returning findings.
2. You may ONLY report findings anchored to lines that appear in the diff below. Every line is labeled with [Line N] showing its exact line number.
3. Every finding MUST include a "codeQuote" field containing the EXACT current code you are flagging. Do not quote deleted code.
3a. The "codeQuote" MUST come entirely from added/current diff lines. Do not quote unchanged declarations, surrounding helper code, or repo-wide context outside the changed lines.
4. The "filePath" MUST be one of the files listed in the diff. Supporting evidence may come from other inspected files, but the finding itself must anchor to a diff file.
5. The "startLine" and "endLine" MUST be line numbers from the [Line N] markers in the diff. Do NOT guess line numbers.
6. DO NOT speculate about code you did not inspect. If the current repository contradicts the concern, do not report it.
7. DO NOT use language like "may contain", "likely has", "could have", "might be", "appears to", "seems to". State facts supported by inspected code.
8. If you find zero issues, return an empty findings array with a high score. That is a valid and good outcome.
9. Only report issues you are confident about (confidence >= 0.7). Do not pad findings with low-confidence guesses.
10. SCOPE DISCIPLINE: Only report findings within your specific area of expertise ("${reviewerName}").
10a. Only report issues materially caused by the changed lines. Do not turn general cleanup suggestions, architecture preferences, logging style preferences, or best-practice wishes into findings unless the diff introduces a concrete correctness, reliability, security, or user-impacting problem.
10b. For logging/diagnostic code, do not report "use structured logging" or similar style advice unless the changed code demonstrably leaks secrets, PII, credentials, internal endpoints, or other actionable sensitive values.
10c. For resiliency concerns, do not require retries, backoff, or timeout patterns unless the changed code actually performs the external/network operation in question and the missing guard creates a concrete risk now.
10d. Do NOT report findings in documentation files (.md, .txt, .rst), template files, example files, or files that DESCRIBE anti-patterns rather than implement them. A file that lists "you should avoid doing X" is not itself a defect — only report findings in actual source code, configuration, or build files.
10e. COMMIT INTENT: Before reporting that something is "missing", "not handled", or "inconsistent" — read the commit messages provided above. If the commit message explicitly explains the design decision, it is intentional. Do NOT report it as a finding.
10f. PR INTENT BLOCK: The user message contains a "PR INTENT" section written by the PR orchestrator. If anything you are about to report is described there as a deliberate, planned, or expected change — DO NOT report it. Examples of things to suppress: "logging is intentional", "fallback was removed on purpose", "interface was extended by design", "cap is intentional for cost control". When in doubt, check the PR INTENT and default to NOT reporting.
10f. DOCUMENTATION GAPS: If the changed lines introduce or modify user-facing behavior (CLI flags, config fields, API signatures, public interfaces, new commands) — check whether relevant documentation files (README.md, AGENTS.md, CLAUDE.md, docs/) reflect the change. If documentation is stale or missing, report a documentation gap finding anchored to the CHANGED CODE LINES that create the obligation (not to the documentation file itself). Set filePath, startLine, and endLine to the changed code. In the description and recommendation, specify exactly which documentation file and section needs updating.
11. Every finding MUST include a "verificationTrail" with 1-5 entries. Use exact prefixes:
    - "file:<relative path>" for each file you inspected
    - "search:<query>" for repo-wide searches you performed
    - "note:<short note>" for any other verification step
12. Include "searchedFor" when you investigated an absence/regression claim. It should list the exact symbol, behavior, or config you checked for.

## Output Format

Return ONLY this JSON:
\`\`\`json
{
  "score": <number 0-100, where 100 = no issues found>,
  "summary": "<brief summary of real findings>",
  "findings": [
    {
      "id": "${prefix}_PR_<sequential number>",
      "title": "<concise, specific finding title>",
      "description": "<detailed description citing the exact code>",
      "priority": "<critical|high|medium|low|info>",
      "confidence": <0.7-1.0>,
      "filePath": "<exact file path from the diff>",
      "startLine": <exact line number from [Line N] marker>,
      "endLine": <exact line number>,
      "codeQuote": "<EXACT current code being flagged>",
      "evidence": ["<repo-backed evidence supporting the issue>"],
      "verificationTrail": ["file:path/to/file.ts", "search:cache: 'npm'"],
      "searchedFor": ["cache: 'npm'"],
      "recommendation": "<specific, actionable fix>",
      "tags": []
    }
  ]
}
\`\`\``;
}

export function buildPRReviewUserMessage(
  structuredDiff: string,
  changedFiles: string[],
  currentFileContext: string,
  additionalContext?: string,
  commits?: CommitSummary[],
  intentSummary?: string,
): string {
  const maxLen = 24000;
  const diffContent = structuredDiff.length > maxLen
    ? structuredDiff.slice(0, maxLen) + '\n\n[...diff truncated...]'
    : structuredDiff;

  const commitSection = commits && commits.length > 0
    ? `\n## Commit History for This PR\nUse these to understand the author's intent before flagging anything as missing or broken:\n${commits.map(c => `- ${c.sha.slice(0, 12)} ${c.subject}`).join('\n')}\n`
    : '';

  const intentSection = intentSummary
    ? `\n## ⚠ PR INTENT — READ BEFORE REPORTING ANYTHING\n\n${intentSummary}\n\nMANDATORY CHECK: Before writing any finding, ask: "Is this already described as deliberate in the PR Intent above?" If YES — skip it entirely. Do not mention it, do not soften it into a suggestion, do not report it as a risk. Silence is the correct output for intentional changes.\n`
    : '';

  return `## Files Changed in This PR
${changedFiles.map(f => `- ${f}`).join('\n')}
${intentSection}${commitSection}
## Code Changes

Below are the exact changes in this PR. Each line is labeled with [Line N] showing its line number in the new file.
Lines marked with + are additions. Lines marked with - are removals. Other lines are context.

${diffContent}

## Current Changed File Contents
${currentFileContext}
${additionalContext ? '\n## Additional Context\n' + additionalContext : ''}

Investigate the repository before reporting any finding. Return the JSON result. If no issues found, return an empty findings array.`;
}

export function buildPRFindingVerificationSystemPrompt(): string {
  return `You are a strict PR finding verifier.

Your task is to decide whether a proposed finding is supported by the CURRENT codebase state.

Rules:
- Reject findings that depend only on removed code.
- Reject findings that claim something is missing unless the supplied current files actually support that claim.
- Reject findings contradicted by current-file evidence.
- If evidence is insufficient, return supported=false.
- Return ONLY JSON.`;
}

export function buildPRFindingBatchVerificationSystemPrompt(): string {
  return `You are a conservative PR finding verifier. Your primary goal is to avoid suppressing valid findings.

GOLDEN RULE: When in doubt, ACCEPT the finding. Only reject when you are 100% certain it is a false positive.

For each finding in the batch, decide whether it is supported by the CURRENT codebase state AND materially related to the pull request changes.

Rejection rules (apply ONLY when you are absolutely certain):
- Reject ONLY if the anchor file is definitively not present in the PR diff AND the finding clearly has no connection to any changed file.
- Reject ONLY if the finding explicitly references removed code and nothing in the current file confirms the issue still exists.
- Reject ONLY if current-file evidence directly and unambiguously contradicts the finding's claim (e.g. the finding says X is missing but X is clearly present in the file).
- Reject ONLY if the finding is plainly unrelated to this PR with no plausible connection to any changed line.

When to accept (prefer accepting):
- If the anchor lines are near but not exactly in the diff hunk, ACCEPT — the verifier has tolerance for nearby lines.
- If supporting evidence is partial or incomplete, ACCEPT — the original reviewer had more context.
- If the finding could plausibly be valid even if you are not fully certain, ACCEPT.
- If you cannot determine whether the finding is valid or not, ACCEPT (do NOT default to reject on uncertainty).
- If the finding is about a missing companion update and you cannot rule it out, ACCEPT.
- Style and architecture findings: only reject if they are completely unrelated to any changed line; otherwise ACCEPT.

Think step by step before deciding. Consider multiple interpretations of the evidence. Only after exhausting all possible ways the finding could be valid should you consider rejecting it.

Classify every finding as one of:
  - direct: directly about a defect/risk in the changed lines
  - companion: a required related update is missing because of the changed lines
  - unrelated: not materially caused by this PR
  - unclear: evidence is insufficient (always mark supported=true for unclear findings)

You MUST return a verdict for EVERY finding in the input — the output array length must equal the input array length.
Return ONLY JSON.`;
}

export function buildPRFindingBatchVerificationUserMessage(
  batch: Array<{
    finding: PRFinding;
    currentFileContent: string;
    diffContext: string;
    supportingFiles: Array<{ filePath: string; content: string }>;
  }>,
): string {
  const items = batch.map(({ finding, currentFileContent, diffContext, supportingFiles }, i) => {
    const supportingSections = supportingFiles.length === 0
      ? 'None'
      : supportingFiles.map(file => `#### ${file.filePath}\n\`\`\`\n${file.content}\n\`\`\``).join('\n\n');
    return `### Finding ${i + 1} — id: "${finding.id}"
\`\`\`json
${JSON.stringify({
  id: finding.id,
  title: finding.title,
  description: finding.description,
  codeQuote: finding.codeQuote,
  filePath: finding.filePath,
  startLine: finding.startLine,
  endLine: finding.endLine,
  verificationTrail: finding.verificationTrail,
  searchedFor: finding.searchedFor || [],
}, null, 2)}
\`\`\`

#### PR Diff Context
${diffContext}

#### Current File: ${finding.filePath}
\`\`\`
${currentFileContent}
\`\`\`

#### Supporting Files
${supportingSections}`;
  });

  return `${items.join('\n\n---\n\n')}

---

Verify each finding. Return JSON:
\`\`\`json
{
  "verifications": [
    { "findingId": "<id>", "supported": true, "classification": "direct", "reason": "why" },
    { "findingId": "<id>", "supported": false, "classification": "unrelated", "reason": "why not" }
  ]
}
\`\`\`
The array must contain exactly ${batch.length} entries, one per finding in order.`;
}

export function buildPRFindingVerificationUserMessage(
  finding: PRFinding,
  currentFileContent: string,
  supportingFiles: Array<{ filePath: string; content: string }>,
): string {
  const supportingSections = supportingFiles.length === 0
    ? 'None'
    : supportingFiles.map(file => `### ${file.filePath}\n\`\`\`\n${file.content}\n\`\`\``).join('\n\n');

  return `## Candidate Finding
\`\`\`json
${JSON.stringify(finding, null, 2)}
\`\`\`

## Current Primary File
### ${finding.filePath}
\`\`\`
${currentFileContent}
\`\`\`

## Supporting Files
${supportingSections}

Decide whether this finding is supported by the current code. Return JSON:
\`\`\`json
{
  "supported": true,
  "reason": "why",
  "counterEvidence": []
}
\`\`\``;
}

export interface ToolSummaryEntry {
  reviewerName: string;
  toolRan: boolean;
  findingCount: number;
  error?: string;
}

export function buildPRSummaryPrompt(
  findings: PRFinding[],
  status: ReviewRunStatus,
  issues: ReviewIssue[],
  verificationStats?: {
    rawFindings: number;
    deterministicRejected: number;
    semanticRejected: number;
    finalFindings: number;
  },
  toolSummaries?: ToolSummaryEntry[]
): string {
  const bySeverity = {
    critical: findings.filter(f => f.priority === 'critical'),
    high: findings.filter(f => f.priority === 'high'),
    medium: findings.filter(f => f.priority === 'medium'),
    low: findings.filter(f => f.priority === 'low'),
    info: findings.filter(f => f.priority === 'info'),
  };

  const verificationSection = verificationStats
    ? `\n### Verification\n\n| Stage | Count |\n|-------|-------|\n| Raw findings | ${verificationStats.rawFindings} |\n| Rejected (deterministic) | ${verificationStats.deterministicRejected} |\n| Rejected (semantic) | ${verificationStats.semanticRejected} |\n| Final findings | ${verificationStats.finalFindings} |\n`
    : '';

  const issueSection = issues.length > 0
    ? `\n### Review Issues\n\n${issues.slice(0, 10).map(issue => `- ${issue.severity.toUpperCase()}: ${issue.message}`).join('\n')}\n`
    : '';

  let scannerSection = '';
  if (toolSummaries && toolSummaries.length > 0) {
    const rows = toolSummaries.map(s => {
      if (!s.toolRan) {
        const reason = s.error ? s.error.slice(0, 60) : 'not available';
        return `| ${s.reviewerName} | ⚠️ Skipped — ${reason} |`;
      }
      return `| ${s.reviewerName} | ✅ Ran — ${s.findingCount} finding${s.findingCount === 1 ? '' : 's'} |`;
    });
    scannerSection = `\n### 🔧 Static Analysis Scanners\n\n| Scanner | Result |\n|---------|--------|\n${rows.join('\n')}\n`;
  }

  return `${BATEYE_SUMMARY_MARKER}
## BatEye PR Review Summary

| Severity | Count |
|----------|-------|
| 🔴 Critical | ${bySeverity.critical.length} |
| 🟠 High | ${bySeverity.high.length} |
| 🟡 Medium | ${bySeverity.medium.length} |
| 🟢 Low | ${bySeverity.low.length} |
| ℹ️ Info | ${bySeverity.info.length} |

${status === 'degraded'
    ? '⚠️ Review completed with warnings. Coverage was degraded; see Review Issues below.'
    : findings.length === 0
      ? '✅ No issues found.'
      : `**${findings.length} total findings.** See inline comments for details.`}
${verificationSection}${issueSection}${scannerSection}
---
*Generated by [BatEye](https://github.com/bateye/bateye)*`;
}
