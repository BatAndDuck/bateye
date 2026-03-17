import { CODEOWL_SUMMARY_MARKER } from '../config/defaults';
import { PRFinding, ReviewIssue, ReviewRunStatus } from '../../types/index';
import { CommitSummary } from '../git/index';

export function buildOrchestratorSystemPrompt(availableReviewers: { id: string; name: string; description?: string; scopeHints?: string[] }[]): string {
  const reviewerList = availableReviewers
    .map(r => `- id: "${r.id}", name: "${r.name}"${r.description ? ', description: "' + r.description + '"' : ''}${r.scopeHints ? ', scopeHints: [' + r.scopeHints.join(', ') + ']' : ''}`)
    .join('\n');

  return `You are a PR review orchestrator. Given a pull request diff, changed files, and commit history, select the reviewers that are relevant to investigating this PR.

## Available Reviewers
${reviewerList}

## Output Requirements

Return ONLY this JSON:
\`\`\`json
{
  "selectedReviewers": [
    {
      "reviewerId": "<id from the list above>",
      "reason": "<why this reviewer is relevant to the changes>"
    }
  ]
}
\`\`\`

## Selection Rules

- Bias toward broader coverage when the PR touches production code, workflows, tests, dependency manifests, or multiple commits.
- Scope by file type and subsystem. Include reviewers that match the changed files, surrounding subsystem, or attached tool coverage.
- For meaningful code changes, prefer about 3 reviewers when available.
- For multi-domain PRs, workflow changes, or larger multi-commit PRs, prefer about 5 reviewers when available.
- Include tool-enhanced scanners when the changed files match the scanner domain and the tool can materially validate the change.
- Avoid overlapping broad code-quality reviewers unless the diff clearly spans multiple distinct concerns.
- Include logging/observability or resiliency reviewers only when the changed lines directly touch logging output, retries, timeouts, networking, or process reliability behavior.
- Avoid reviewers that are clearly irrelevant to the diff, and when in doubt prefer omission over speculative overlap.
- Never return an empty array unless the diff contains zero code changes.
- Return ONLY the JSON`;
}

export function buildOrchestratorUserMessage(changedFiles: string[], diff: string, commits: CommitSummary[]): string {
  const diffPreview = diff.length > 16000 ? diff.slice(0, 16000) + '\n\n[...diff truncated...]' : diff;
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

export function buildPRReviewSystemPrompt(reviewerInstructions: string, reviewerId: string, reviewerName: string): string {
  const prefix = reviewerId.toUpperCase().replace(/-/g, '_');

  return `You are a precise code reviewer performing a "${reviewerName}" review on a pull request.

${reviewerInstructions}
${buildPRModeOverlay(reviewerId)}

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
  additionalContext?: string
): string {
  const maxLen = 24000;
  const diffContent = structuredDiff.length > maxLen
    ? structuredDiff.slice(0, maxLen) + '\n\n[...diff truncated...]'
    : structuredDiff;

  return `## Files Changed in This PR
${changedFiles.map(f => `- ${f}`).join('\n')}

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
  return `You are a strict PR finding verifier.

For each finding in the batch, decide whether it is supported by the CURRENT codebase state.

Rules:
- Reject findings that depend only on removed code.
- Reject findings that claim something is missing unless the supplied current files confirm it.
- Reject findings contradicted by current-file evidence.
- If evidence is insufficient, return supported=false.
- You MUST return a verdict for EVERY finding in the input — the output array length must equal the input array length.
- Return ONLY JSON.`;
}

export function buildPRFindingBatchVerificationUserMessage(
  batch: Array<{
    finding: PRFinding;
    currentFileContent: string;
    supportingFiles: Array<{ filePath: string; content: string }>;
  }>,
): string {
  const items = batch.map(({ finding, currentFileContent, supportingFiles }, i) => {
    const supportingSections = supportingFiles.length === 0
      ? 'None'
      : supportingFiles.map(file => `#### ${file.filePath}\n\`\`\`\n${file.content}\n\`\`\``).join('\n\n');
    return `### Finding ${i + 1} — id: "${finding.id}"
\`\`\`json
${JSON.stringify({ id: finding.id, title: finding.title, description: finding.description, codeQuote: finding.codeQuote, filePath: finding.filePath }, null, 2)}
\`\`\`

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
    { "findingId": "<id>", "supported": true, "reason": "why" },
    { "findingId": "<id>", "supported": false, "reason": "why not" }
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

  return `${CODEOWL_SUMMARY_MARKER}
## CodeOwl PR Review Summary

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
*Generated by [CodeOwl](https://github.com/codeowl/codeowl)*`;
}
