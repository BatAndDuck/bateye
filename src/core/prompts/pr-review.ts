import { BATEYE_SUMMARY_MARKER } from '../config/defaults';
import { PRFinding, ReviewIssue, ReviewRunStatus, ReviewerPlanSelection } from '../../types/index';
import { CommitSummary } from '../git/index';
import { RepoProfile } from './audit';
import type { PRFindingDuplicateCandidate } from '../pr-review/deduplicator';

const PLANNER_DIFF_PREVIEW_MAX_CHARS = 24_000;

function truncateDedupField(text: string | undefined, limit: number): string {
  if (!text) {
    return '';
  }

  const normalized = text.replace(/\s+/g, ' ').trim();
  if (normalized.length <= limit) {
    return normalized;
  }

  return `${normalized.slice(0, limit - 3)}...`;
}

export function buildPRPlannerSystemPrompt(availableReviewers: { id: string; name: string; description?: string; selectWhen?: string }[]): string {
  const reviewerList = availableReviewers
    .map(r => {
      let line = `- id: "${r.id}", name: "${r.name}"`;
      if (r.description) line += `, description: "${r.description}"`;
      if (r.selectWhen) line += `\n  selectWhen: "${r.selectWhen}"`;
      return line;
    })
    .join('\n');

  return `You are BatEye's deep PR review planner. This is the expensive one-time investigation stage that must fully understand the pull request before bounded reviewers run.

## Available Reviewers
${reviewerList}

## Investigation Responsibilities

- Use the repository tools aggressively. Deep mode and subagents are enabled for this run, with a budget of up to 150 steps.
- Investigate the changed files, surrounding folders, neighboring modules, imports, exports, callers, callees, indirect dependencies, docs, configs, fixtures, examples, and existing tests.
- Derive business context only from repository evidence such as names, docs, tests, comments, commit history, and nearby modules.
- Trace full vertical flows for every changed concern. For CQRS-style changes, trace both what invokes the command/handler and what the command/handler invokes next.
- If the PR changes multiple commands, handlers, services, or flows, cover each of them explicitly. Do not collapse unrelated changes into one generic summary.
- Partition reviewer responsibilities so reviewers do not redundantly rediscover the same context.
- Besides reviewer selection, proactively note likely issue leads discovered during planning. These are hints for reviewers, not final findings.

## Output Requirements

CRITICAL OUTPUT RULE: Your ENTIRE response must be valid JSON. Start your response with { and end with }. Write NO text before or after the JSON. NO markdown code blocks. NO explanation. NO introduction sentences. If your response contains anything other than the JSON object, the system will crash.

Your response must look exactly like this (replace the example values):
{
  "intentSummary": "This PR introduces a new token description flow and updates the command path that persists and surfaces it. The broader migration to planner-led PR review is intentional, so downstream reviewers should not flag the new planner/reviewer split itself as accidental.",
  "selectedReviewers": [
    {
      "reviewerId": "security-api",
      "reason": "Authentication- and token-related behavior changed across command, service, and transport layers.",
      "confidence": 0.95
      "briefing": "Start at src/auth/describe-token.ts and src/api/token-controller.ts. Trace the full token-description flow from HTTP entrypoint -> command dispatch -> token metadata service -> persistence adapter. Compare against src/auth/refresh-token.ts for consistency. Security docs are in docs/security/tokens.md and tests are in test/auth/token-controller.test.ts. I already noticed likely issues worth checking: token description appears to bypass the shared validation helper, and the persistence adapter path differs from the existing refresh-token flow.",
      "contextPaths": ["src/auth/describe-token.ts", "src/api/token-controller.ts", "src/auth", "docs/security/tokens.md", "test/auth"],
      "verticalFlows": [
        "HTTP token description request -> controller -> CQRS command -> token metadata service -> persistence adapter",
        "Existing token refresh flow in src/auth/refresh-token.ts -> shared validator -> persistence adapter"
      ],
      "businessContext": [
        "Token descriptions appear to be user-visible metadata surfaced through the API.",
        "Tests and docs suggest token metadata should follow the same validation and audit path as refresh tokens."
      ],
      "consistencyReferences": [
        "src/auth/refresh-token.ts",
        "src/auth/shared/token-validator.ts"
      ],
      "testLocations": [
        "test/auth/token-controller.test.ts",
        "test/auth/refresh-token.test.ts",
        "test/integration/auth"
      ],
      "issueHints": [
        "Changed token description path may bypass the shared validator used by refresh-token flow.",
        "Controller/service/persistence naming suggests an audit trail update may be missing."
      ]
    }
  ]
}

## intentSummary

Before selecting reviewers, write a concise (2-4 sentence) \`intentSummary\` that captures:
1. What this PR is trying to accomplish (the primary goal).
2. Which changes look deliberate / intentional - e.g., "planner/reviewer split is intentional", "API signature changed as part of a planned migration", "diagnostics are intentionally verbose".

Reviewers will receive this summary so they can skip findings about deliberate design decisions.

## Reviewer Planning Rules

- **Select all reviewers that are relevant** - there is no target number. A PR touching many concerns should have many reviewers; a trivial change may need only one.
- **Use the selectWhen field** on each reviewer as the primary guide for whether to include it. If the PR content matches a reviewer's selectWhen condition, include that reviewer.
- For reviewers without a selectWhen field, use their name and description to judge relevance against the changed files and diff content.
- **Err toward inclusion** when in doubt, but partition context so reviewers overlap as little as possible.
- Include reviewers for every concern visible in the diff: code quality, security, error handling, documentation, resilience, logging, tests, CI/CD, etc.
- Exclude a reviewer only when the diff clearly has no overlap with the reviewer's domain (e.g., do not include a database reviewer for a pure UI change).
- Never return an empty array unless the diff contains zero code changes.
- **confidence** (0–1): rate your certainty that this reviewer is relevant. Use ≥ 0.9 when the match is obvious, 0.7–0.89 when probable, 0.5–0.69 when possible. Only include reviewers with confidence ≥ 0.5.
- **briefing**: write a compact reviewer-facing message that tells the reviewer where to start, what changed in their domain, which flow to trace, which docs/config/tests matter, which nearby folders may contain indirect effects, and which likely issue leads you already noticed.
- **contextPaths**: list focused starting files or folders. Prefer concise, high-signal paths.
- **verticalFlows**: list the end-to-end flows this reviewer should trace.
- **businessContext**: include only repo-evidenced domain context that materially helps this reviewer.
- **consistencyReferences**: include only genuinely useful comparison points elsewhere in the repo.
- **testLocations**: list exact relevant test files or test directories, and include nearby gaps if changed behavior appears untested.
- **issueHints**: include 0-5 short, repo-evidenced leads about where issues may exist. These are hints, not final verdicts.
- Keep the output compact enough that reviewer prompts shrink overall token usage rather than grow.

- Return ONLY the JSON`;
}

export function buildPRPlannerUserMessage(changedFiles: string[], diff: string, commits: CommitSummary[]): string {
  const diffPreview = diff.length > PLANNER_DIFF_PREVIEW_MAX_CHARS ? diff.slice(0, PLANNER_DIFF_PREVIEW_MAX_CHARS) + '\n\n[...diff truncated - investigate the repository directly for the rest...]' : diff;
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

  Plan the reviewer set and prepare reviewer-specific briefings. Use the repo tools to investigate deeply before answering.`;
}

export function buildPRDedupArbiterSystemPrompt(): string {
  return `You are BatEye's PR deduplication arbiter.

Your job is to decide whether PAIRS of findings describe the same underlying defect.

Return "duplicate" ONLY when both findings point to the same root cause in the same code location or tiny code block, with substantially the same evidence and substantially the same fix.

Return "distinct" when the findings may share a file, line, or code quote but describe different failure modes, different risks, different recommendations, or different reviewer concerns.

Examples of DISTINCT pairs:
- "logs part of auth token" vs "missing retry on transient API error"
- "missing validation" vs "poor naming"
- "security leak" vs "documentation gap"

Return "unsure" when the pair might overlap but you cannot confidently call it the same defect.

Critical rules:
- Default to keeping both findings when uncertain.
- Do not merge findings just because they share a line number.
- Do not merge findings just because they are from different reviewers discussing the same general area.
- Do not use reviewer priority as a reason to merge.
- You must return a decision for every pair listed in the user message.

Return ONLY valid JSON with this shape:
{
  "decisions": [
    {
      "aId": "F1",
      "bId": "F2",
      "verdict": "duplicate",
      "confidence": 0.91,
      "rationale": "Both findings describe the same missing validation step in the same changed block."
    }
  ]
}`;
}

export function buildPRDedupArbiterUserMessage(candidates: PRFindingDuplicateCandidate[]): string {
  const pairSections = candidates.map((candidate, index) => {
    const a = candidate.a;
    const b = candidate.b;

    return [
      `### Pair ${index + 1}`,
      `aId: ${a.id}`,
      `bId: ${b.id}`,
      `sameAnchor: ${candidate.sameAnchor ? 'true' : 'false'}`,
      `linesClose: ${candidate.linesClose ? 'true' : 'false'}`,
      `codeQuoteOverlap: ${candidate.codeQuoteOverlap ? 'true' : 'false'}`,
      `lineOverlapFraction: ${candidate.lineOverlapFraction.toFixed(2)}`,
      `titleSimilarity: ${candidate.titleSimilarity.toFixed(2)}`,
      '',
      'Finding A',
      `- reviewer: ${a.reviewerName}`,
      `- priority: ${a.priority}`,
      `- file: ${a.filePath}:${a.startLine}-${a.endLine}`,
      `- title: ${truncateDedupField(a.title, 180)}`,
      `- description: ${truncateDedupField(a.description, 320)}`,
      `- codeQuote: ${truncateDedupField(a.codeQuote, 240)}`,
      `- recommendation: ${truncateDedupField(a.recommendation, 200)}`,
      '',
      'Finding B',
      `- reviewer: ${b.reviewerName}`,
      `- priority: ${b.priority}`,
      `- file: ${b.filePath}:${b.startLine}-${b.endLine}`,
      `- title: ${truncateDedupField(b.title, 180)}`,
      `- description: ${truncateDedupField(b.description, 320)}`,
      `- codeQuote: ${truncateDedupField(b.codeQuote, 240)}`,
      `- recommendation: ${truncateDedupField(b.recommendation, 200)}`,
    ].join('\n');
  });

  return `Decide whether each pair below is "duplicate", "distinct", or "unsure".
You must return one decision per pair.

${pairSections.join('\n\n')}`;
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
- The planner already did the expensive global investigation. Use its briefing as your starting point instead of rediscovering the entire repository.
- Your runtime budget is intentionally bounded. Choose each step deliberately and avoid redundant exploration.
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
## HOW TO DO THIS REVIEW - TWO PHASES

### PHASE 1: INVESTIGATE FIRST (form no opinions yet)
0. **Read the "PR INTENT" section in the user message first.** It describes what the author deliberately changed and why. Any concern that matches something described there is NOT a finding - skip it immediately, before any other investigation.
1. Open and read the changed files listed in the diff.
2. Follow imports and references to understand context outside the diff.
3. Use search tools to confirm whether a problem actually exists in the current codebase.
4. For each potential concern, find the EXACT line in the diff that causes the problem.
5. Read the commit messages in this PR. If a commit message or code comment already explains the design decision behind a potential concern, that concern is intentional - do NOT report it.
6. Check adjacent documentation (README.md, AGENTS.md, CLAUDE.md, docs/) to see if the behavior you are about to flag is already described there.

### PHASE 2: DECIDE WHAT TO REPORT (only after investigation)
5. Ask yourself: "Did I read actual code in the diff that proves this problem exists at a specific line?"
6. If "yes" → report it. If "maybe" or "not sure" → do NOT report it.
7. Ask yourself: "Does this concern apply to THIS project type?" (see Repository Profile above). If not → do NOT report it.
8. Zero findings is a VALID and GOOD outcome. Never pad with uncertain concerns.

## STRICT RULES - MUST FOLLOW

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
10d. Do NOT report findings in documentation files (.md, .txt, .rst), template files, example files, or files that DESCRIBE anti-patterns rather than implement them. A file that lists "you should avoid doing X" is not itself a defect - only report findings in actual source code, configuration, or build files.
10e. COMMIT INTENT: Before reporting that something is "missing", "not handled", or "inconsistent" - read the commit messages provided above. If the commit message explicitly explains the design decision, it is intentional. Do NOT report it as a finding.
10f. PR INTENT BLOCK: The user message contains a "PR INTENT" section written by the PR orchestrator. If anything you are about to report is described there as a deliberate, planned, or expected change - DO NOT report it. Examples of things to suppress: "logging is intentional", "fallback was removed on purpose", "interface was extended by design", "cap is intentional for cost control". When in doubt, check the PR INTENT and default to NOT reporting.
10f. DOCUMENTATION GAPS: If the changed lines introduce or modify user-facing behavior (CLI flags, config fields, API signatures, public interfaces, new commands) - check whether relevant documentation files (README.md, AGENTS.md, CLAUDE.md, docs/) reflect the change. If documentation is stale or missing, report a documentation gap finding anchored to the CHANGED CODE LINES that create the obligation (not to the documentation file itself). Set filePath, startLine, and endLine to the changed code. In the description and recommendation, specify exactly which documentation file and section needs updating.
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
  options: {
    structuredDiff: string;
    changedFiles: string[];
    currentFileContext: string;
    toolContext?: string;
    commits?: CommitSummary[];
    intentSummary?: string;
    plannerSelection?: ReviewerPlanSelection;
    usingPlannerContext?: boolean;
    plannerFallbackReason?: string;
  },
): string {
  const {
    structuredDiff,
    changedFiles,
    currentFileContext,
    toolContext,
    commits,
    intentSummary,
    plannerSelection,
    usingPlannerContext,
    plannerFallbackReason,
  } = options;
  const maxLen = 24000;
  const diffContent = structuredDiff.length > maxLen
    ? structuredDiff.slice(0, maxLen) + '\n\n[...diff truncated...]'
    : structuredDiff;

  const commitSection = commits && commits.length > 0
    ? `\n## Commit History for This PR\nUse these to understand the author's intent before flagging anything as missing or broken:\n${commits.map(c => `- ${c.sha.slice(0, 12)} ${c.subject}`).join('\n')}\n`
    : '';

  const intentSection = intentSummary
    ? `\n## ⚠ PR INTENT - READ BEFORE REPORTING ANYTHING\n\n${intentSummary}\n\nMANDATORY CHECK: Before writing any finding, ask: "Is this already described as deliberate in the PR Intent above?" If YES - skip it entirely. Do not mention it, do not soften it into a suggestion, do not report it as a risk. Silence is the correct output for intentional changes.\n`
    : '';

  const plannerBriefingSection = plannerSelection
    ? `\n## Planner Briefing\n\n${plannerSelection.briefing || 'No planner briefing was provided.'}\n`
    : '';
  const plannerPathsSection = plannerSelection?.contextPaths?.length
    ? `\n## Planner Starting Paths\n${plannerSelection.contextPaths.map(item => `- ${item}`).join('\n')}\n`
    : '';
  const plannerFlowsSection = plannerSelection?.verticalFlows?.length
    ? `\n## Planner Flow Notes\n${plannerSelection.verticalFlows.map(item => `- ${item}`).join('\n')}\n`
    : '';
  const plannerBusinessSection = plannerSelection?.businessContext?.length
    ? `\n## Planner Business Context\n${plannerSelection.businessContext.map(item => `- ${item}`).join('\n')}\n`
    : '';
  const plannerConsistencySection = plannerSelection?.consistencyReferences?.length
    ? `\n## Planner Consistency References\n${plannerSelection.consistencyReferences.map(item => `- ${item}`).join('\n')}\n`
    : '';
  const plannerTestsSection = plannerSelection?.testLocations?.length
    ? `\n## Planner Test Locations\n${plannerSelection.testLocations.map(item => `- ${item}`).join('\n')}\n`
    : '';
  const plannerIssueHintsSection = plannerSelection?.issueHints?.length
    ? `\n## Planner Issue Hints\n${plannerSelection.issueHints.map(item => `- ${item}`).join('\n')}\n`
    : '';
  const plannerScopeSection = plannerSelection
    ? usingPlannerContext
      ? '\n## Reviewer Scope\nThe diff and file context below were narrowed by the planner for your domain. Start here and broaden only if the evidence demands it.\n'
      : `\n## Reviewer Scope\nPlanner metadata existed for this reviewer, but BatEye had to fall back to the broader PR context for execution.\nReason: ${plannerFallbackReason || 'Planner paths were missing or too sparse.'}\n`
    : '\n## Reviewer Scope\nBatEye is providing the broader PR context because no planner-specific slice was available for this reviewer.\n';

  return `## Files Changed in This PR
${changedFiles.map(f => `- ${f}`).join('\n')}
${intentSection}${commitSection}${plannerBriefingSection}${plannerPathsSection}${plannerFlowsSection}${plannerBusinessSection}${plannerConsistencySection}${plannerTestsSection}${plannerIssueHintsSection}${plannerScopeSection}
## Code Changes

Below are the exact changes BatEye is asking you to inspect for this review. Each line is labeled with [Line N] showing its line number in the new file.
Lines marked with + are additions. Lines marked with - are removals. Other lines are context.

${diffContent}

## Current Changed File Contents
${currentFileContext}
${toolContext ? '\n## Additional Context\n' + toolContext : ''}

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
- If the anchor lines are near but not exactly in the diff hunk, ACCEPT - the verifier has tolerance for nearby lines.
- If supporting evidence is partial or incomplete, ACCEPT - the original reviewer had more context.
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

You MUST return a verdict for EVERY finding in the input - the output array length must equal the input array length.
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
    return `### Finding ${i + 1} - id: "${finding.id}"
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
    ? `\n### Verification\n\n| Stage | Count |\n|-------|-------|\n| Raw findings | ${verificationStats.rawFindings} |\n| Rejected (deterministic) | ${verificationStats.deterministicRejected} |\n| Final findings | ${verificationStats.finalFindings} |\n`
    : '';

  const issueSection = issues.length > 0
    ? `\n### Review Issues\n\n${issues.slice(0, 10).map(issue => `- ${issue.severity.toUpperCase()}: ${issue.message}`).join('\n')}\n`
    : '';

  let scannerSection = '';
  if (toolSummaries && toolSummaries.length > 0) {
    const rows = toolSummaries.map(s => {
      if (!s.toolRan) {
        const reason = s.error ? s.error.slice(0, 60) : 'not available';
        return `| ${s.reviewerName} | ⚠️ Skipped - ${reason} |`;
      }
      return `| ${s.reviewerName} | ✅ Ran - ${s.findingCount} finding${s.findingCount === 1 ? '' : 's'} |`;
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
