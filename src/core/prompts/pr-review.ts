import { CODEOWL_SUMMARY_MARKER } from '../config/defaults';
import { PRFinding } from '../../types/index';

export function buildOrchestratorSystemPrompt(availableReviewers: { id: string; name: string; description?: string; scopeHints?: string[] }[]): string {
  const reviewerList = availableReviewers
    .map(r => `- id: "${r.id}", name: "${r.name}"${r.description ? ', description: "' + r.description + '"' : ''}${r.scopeHints ? ', scopeHints: [' + r.scopeHints.join(', ') + ']' : ''}`)
    .join('\n');

  return `You are a PR review orchestrator. Given a pull request diff and changed files, select ALL reviewers that could plausibly be relevant to the changes.

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

- **Be inclusive, not exclusive** — when in doubt, include the reviewer. It is better to run an extra reviewer than to miss a real issue.
- **Always include** general reviewers (security, code-quality, documentation) for any non-trivial change.
- **Scope by file type**: include language/framework reviewers that match the changed files (e.g. TypeScript reviewer for .ts files, CSS reviewer for .css/.scss files, HTML reviewer for .html files).
- **Include tool-enhanced scanners** for any code changes: security scanners for any source file change, type checkers for TypeScript changes, lint scanners for JS/TS changes.
- **Minimum**: select at least 3 reviewers for any PR with meaningful code changes. Only return fewer if the PR is trivially small (docs-only, single-line config change, etc.).
- Never return an empty array unless the diff contains zero code changes.
- Return ONLY the JSON`;
}

export function buildOrchestratorUserMessage(changedFiles: string[], diff: string): string {
  const diffPreview = diff.length > 16000 ? diff.slice(0, 16000) + '\n\n[...diff truncated...]' : diff;
  return `## Changed Files
${changedFiles.map(f => `- ${f}`).join('\n')}

## Diff
\`\`\`diff
${diffPreview}
\`\`\`

Which reviewers should analyze this PR?`;
}

export function buildPRReviewSystemPrompt(reviewerInstructions: string, reviewerId: string, reviewerName: string): string {
  const prefix = reviewerId.toUpperCase().replace(/-/g, '_');

  return `You are a precise code reviewer performing a "${reviewerName}" review on a pull request.

${reviewerInstructions}

## STRICT RULES — MUST FOLLOW

1. You may ONLY report findings on code that appears in the diff below. Every line is labeled with [Line N] showing its exact line number.
2. Every finding MUST include a "codeQuote" field containing the EXACT code you are flagging, copied VERBATIM from the diff. Do not paraphrase or approximate.
3. The "filePath" MUST be one of the files listed in the diff. Do NOT reference files that are not shown.
4. The "startLine" and "endLine" MUST be line numbers from the [Line N] markers in the diff. Do NOT guess line numbers.
5. DO NOT speculate about code you cannot see. DO NOT assume what code outside the diff might look like.
6. DO NOT use language like "may contain", "likely has", "could have", "might be", "appears to", "seems to". State facts about what the code DOES based on what you can SEE.
7. If you find zero issues, return an empty findings array with a high score. That is a valid and good outcome — do not invent issues.
8. Only report issues you are confident about (confidence >= 0.7). Do not pad findings with low-confidence guesses.
9. SCOPE DISCIPLINE: Only report findings within your specific area of expertise ("${reviewerName}"). Do NOT report issues that belong to other reviewer specializations.

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
      "codeQuote": "<EXACT verbatim code from the diff being flagged>",
      "evidence": ["<verbatim code snippet showing the issue>"],
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
  additionalContext?: string
): string {
  // Truncate if needed - structured diff is slightly more verbose
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
${additionalContext ? '\n## Additional Context\n' + additionalContext : ''}

Review ONLY the code shown above. Return the JSON result. If no issues found, return an empty findings array.`;
}

export function buildPRSummaryPrompt(findings: PRFinding[], rejectedCount?: number): string {
  const bySeverity = {
    critical: findings.filter(f => f.priority === 'critical'),
    high: findings.filter(f => f.priority === 'high'),
    medium: findings.filter(f => f.priority === 'medium'),
    low: findings.filter(f => f.priority === 'low'),
    info: findings.filter(f => f.priority === 'info'),
  };

  const rejectedNote = rejectedCount && rejectedCount > 0
    ? `\n_${rejectedCount} findings were filtered out during evidence verification._\n`
    : '';

  return `${CODEOWL_SUMMARY_MARKER}
## CodeOwl PR Review Summary

| Severity | Count |
|----------|-------|
| 🔴 Critical | ${bySeverity.critical.length} |
| 🟠 High | ${bySeverity.high.length} |
| 🟡 Medium | ${bySeverity.medium.length} |
| 🟢 Low | ${bySeverity.low.length} |
| ℹ️ Info | ${bySeverity.info.length} |

${findings.length === 0 ? '✅ No issues found.' : `**${findings.length} total findings.** See inline comments for details.`}
${rejectedNote}
---
*Generated by [CodeOwl](https://github.com/codeowl/codeowl)*`;
}
