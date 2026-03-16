export function buildAuditSystemPrompt(reviewerInstructions: string, reviewerId: string, reviewerName: string): string {
  return `You are a specialized code reviewer performing a "${reviewerName}" analysis.

${reviewerInstructions}

## INVESTIGATION REQUIREMENTS
You are running inside the repository workspace with filesystem/search tools available.
- Use repository navigation tools before reporting findings.
- Treat the seeded files below as a starting point, not as the only evidence you may inspect.
- Inspect neighboring modules, config files, manifests, or tests when needed to confirm or disprove a concern.
- Do not report "missing", "removed", or "no X" claims unless you actually searched the relevant repository locations.
- Prefer zero findings over partially verified concerns.

## SCOPE DISCIPLINE
Only report findings within your specific area of expertise described above. Do NOT report issues that belong to other reviewer specializations (e.g., a Security reviewer should not report code style issues; a Performance reviewer should not report missing auth).

## ACTIONABILITY RULES
Only report findings that are actionable for the current repository snapshot.
- Do NOT report speculative gaps inferred only from the absence of files or tests unless you can point to a concrete production code path that is currently under-protected.
- Do NOT escalate broad strategic backlog items (e.g. "needs E2E tests", "needs full rewrite", "needs architecture redesign") unless the provided code shows a specific, concrete failure mode or maintenance hazard right now.
- Do NOT flag generated artifacts, build output, or copied files such as dist output, build output, coverage output, or generated reports unless the repository intentionally treats them as hand-maintained source.
- For documentation and test-related findings, prefer issues tied to a specific public API, command, config field, or production code path. Avoid generic statements like "no tests found" or "missing docs" without naming the affected code.
- If a dependency appears to be used by shipped runtime code, CLI execution, or optional runtime features, do NOT claim it belongs in devDependencies.
- Do NOT require service-specific operational features such as health endpoints, readiness probes, request retries, or timeout wrappers unless the repository clearly exposes a long-running network service or direct external call sites that are responsible for those concerns.
- If resilience, package validity, or setup concerns are delegated to a shared abstraction, framework, or runtime layer visible in the code, do not report duplicate findings against higher-level orchestration code without evidence that the policy is actually missing there.
- Do NOT treat a file being absent from your provided scope as proof that it is absent from the repository. Only claim something is missing when the repository snapshot or the analyzed code directly contradicts the documentation or expectation.
- When the evidence is ambiguous, return no finding instead of a speculative one.

## Output Requirements

You MUST return a single JSON object with this exact structure:
\`\`\`json
{
  "score": <number 0-100>,
  "summary": "<one paragraph summary of findings>",
  "findings": [
    {
      "id": "<unique string like 'REVIEWER_ID-001'>",
      "title": "<concise finding title>",
      "description": "<detailed description of the issue>",
      "priority": "<critical|high|medium|low|info>",
      "confidence": <0.0-1.0>,
      "filePath": "<relative file path>",
      "startLine": <line number>,
      "endLine": <line number>,
      "evidence": ["<quoted code or reasoning>"],
      "recommendation": "<specific actionable fix>",
      "tags": ["<optional tags>"]
    }
  ]
}
\`\`\`

Rules:
- score reflects overall category health (100 = perfect, 0 = critically broken)
- Only report findings that are supported by evidence in the current repository after investigation
- Findings must be actionable within this repository; do not report generic best-practice wishes without a concrete target
- filePath must be the exact relative path from the repo root
- startLine and endLine must be accurate line numbers from the provided code
- confidence is your certainty that this is a real issue (0.0 to 1.0)
- Return ONLY the JSON, no prose before or after
- The reviewer ID prefix for finding IDs is: ${reviewerId.toUpperCase().replace(/-/g, '_')}`;
}

export function buildAuditUserMessage(
  seedFiles: string[],
  totalFiles: number,
  scopedFiles: number,
  additionalContext?: string,
): string {
  const seedList = seedFiles.length > 0
    ? seedFiles.map(filePath => `- ${filePath}`).join('\n')
    : '- No seed files were selected';

  return `## Repository Context
Total files in repository: ${totalFiles}
Seed files provided for analysis: ${scopedFiles}

## Seed Files To Inspect First

${seedList}
${additionalContext ? '\n' + additionalContext + '\n' : ''}
Investigate the current repository using tools as needed, starting from the seeded files above. Open the files directly in the repository instead of relying on pasted snapshots. Return the JSON result.`;
}

export function buildAuditOrchestratorSystemPrompt(
  availableReviewers: { id: string; name: string; description?: string; category?: string; scopeHints?: string[] }[],
): string {
  const reviewerList = availableReviewers
    .map(r => {
      const parts = [`- id: "${r.id}", name: "${r.name}"`];
      if (r.description) parts.push(`description: "${r.description}"`);
      if (r.category) parts.push(`category: "${r.category}"`);
      if (r.scopeHints?.length) parts.push(`scopeHints: [${r.scopeHints.join(', ')}]`);
      return parts.join(', ');
    })
    .join('\n');

  return `You are an audit orchestrator. Given a repository's file structure and technology profile, decide which reviewers should analyze this codebase.

## Available Reviewers
${reviewerList}

## Selection Rules
- Select reviewers that are relevant to the detected technologies and file types
- Skip reviewers that have no applicable scope (e.g. skip UI/frontend reviewers for a pure backend/CLI repo with no HTML/CSS/JSX files)
- Skip infrastructure reviewers (IaC, container, cloud) if no Dockerfile, Terraform, Helm, or similar infra files are detected
- Skip database reviewers if no SQL, migration files, or ORM patterns are found
- Skip AI-specific reviewers if no LLM/AI library usage is detected
- Skip reviewers whose output would be mostly speculative for this repo profile (for example reviewers requiring end-user journeys, browser flows, or operational runbooks when the repository does not show those concerns)
- Prefer signal over breadth — when in doubt, exclude the reviewer unless the repository profile provides concrete evidence they can add value
- Select AT MOST 20 reviewers total to keep costs manageable
- Avoid selecting reviewers with heavily overlapping concerns; prefer the more specialized one

## Output Format
Return ONLY this JSON:
\`\`\`json
{
  "selectedReviewers": [
    {
      "reviewerId": "<id from the list above>",
      "reason": "<one sentence explaining why this reviewer is relevant>"
    }
  ]
}
\`\`\``;
}

export type RepoProfile = {
  totalFiles: number;
  extensionCounts: Record<string, number>;
  topDirectories: string[];
  hasDockerfile: boolean;
  hasTerraform: boolean;
  hasHelmCharts: boolean;
  hasGitHubActions: boolean;
  hasPackageJson: boolean;
  hasPyProject: boolean;
  hasGoMod: boolean;
  hasSqlFiles: boolean;
  hasGraphQL: boolean;
  hasTestFiles: boolean;
  hasFrontendFiles: boolean;
  hasAiLibraries: boolean;
};

export function buildAuditOrchestratorUserMessage(profile: RepoProfile): string {
  const extSummary = Object.entries(profile.extensionCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([ext, count]) => `  ${ext || '(no ext)'}: ${count}`)
    .join('\n');

  const flags = [
    profile.hasDockerfile && 'Dockerfile present',
    profile.hasTerraform && 'Terraform (.tf) files present',
    profile.hasHelmCharts && 'Helm chart files present',
    profile.hasGitHubActions && 'GitHub Actions workflows present',
    profile.hasPackageJson && 'package.json present (Node.js/JS/TS project)',
    profile.hasPyProject && 'pyproject.toml or requirements.txt present (Python project)',
    profile.hasGoMod && 'go.mod present (Go project)',
    profile.hasSqlFiles && 'SQL or migration files present',
    profile.hasGraphQL && 'GraphQL schema/query files present',
    profile.hasTestFiles && 'Test files detected',
    profile.hasFrontendFiles && 'Frontend files (HTML/CSS/JSX/TSX/Vue/Svelte) detected',
    profile.hasAiLibraries && 'AI/LLM library imports detected (openai, anthropic, langchain, etc.)',
  ].filter(Boolean);

  return `## Repository Profile

Total files: ${profile.totalFiles}

### File Extension Breakdown
${extSummary}

### Top-Level Directories
${profile.topDirectories.map(d => `  - ${d}`).join('\n')}

### Detected Technologies & Signals
${flags.length > 0 ? flags.map(f => `  - ${f}`).join('\n') : '  - No special signals detected'}

Which reviewers should analyze this repository? Return the JSON.`;
}
