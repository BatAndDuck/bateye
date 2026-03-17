function buildRepoProfileSummary(profile: RepoProfile): string {
  const techStack: string[] = [];
  if (profile.hasPackageJson) techStack.push('Node.js / TypeScript / JavaScript');
  if (profile.hasPyProject) techStack.push('Python');
  if (profile.hasGoMod) techStack.push('Go');

  const infra: string[] = [];
  if (profile.hasDockerfile) infra.push('containerized (Dockerfile present)');
  if (profile.hasTerraform) infra.push('Terraform IaC');
  if (profile.hasHelmCharts) infra.push('Kubernetes / Helm');

  const features: string[] = [];
  if (profile.hasSqlFiles) features.push('database / SQL');
  if (profile.hasGraphQL) features.push('GraphQL API');
  if (profile.hasFrontendFiles) features.push('frontend / UI (HTML, CSS, JSX)');
  if (profile.hasAiLibraries) features.push('AI / LLM integration');

  const likely = !profile.hasFrontendFiles && !profile.hasSqlFiles && !profile.hasDockerfile
    ? '\nProject type: likely a local CLI tool or developer library — NOT a web service, NOT a multi-tenant system.'
    : '';

  const lines: string[] = [];
  if (techStack.length) lines.push(`Tech stack: ${techStack.join(', ')}`);
  if (infra.length) lines.push(`Infrastructure: ${infra.join(', ')}`);
  if (features.length) lines.push(`Detected features: ${features.join(', ')}`);
  const hasSignals = techStack.length > 0 || infra.length > 0 || features.length > 0;
  if (!hasSignals) lines.push('No frontend, database, or container signals detected.');

  return `## Repository Profile\n${lines.join('\n')}${likely}\n\nUse this profile when evaluating whether a concern is applicable to THIS project. If the profile contradicts the premise of a finding (e.g. no database detected but finding requires a multi-tenant audit log), do NOT report the finding.`;
}

export function buildAuditSystemPrompt(
  reviewerInstructions: string,
  reviewerId: string,
  reviewerName: string,
  repoProfile?: RepoProfile,
): string {
  const profileSection = repoProfile ? '\n' + buildRepoProfileSummary(repoProfile) + '\n' : '';

  return `You are a specialized code reviewer performing a "${reviewerName}" analysis.
${profileSection}
${reviewerInstructions}

## HOW TO DO THIS REVIEW — TWO PHASES

### PHASE 1: INVESTIGATE FIRST (form no opinions yet)
1. Open and read the seed files listed in the user message.
2. Follow imports, references, and related modules to understand the full context.
3. Use search tools to find relevant patterns across the repository.
4. For each potential concern, find the EXACT code location that demonstrates the problem.

### PHASE 2: DECIDE WHAT TO REPORT (only after investigation)
5. For each concern you found: ask yourself "Did I read actual code that proves this problem exists at a specific file and line?"
6. If the answer is "yes" → report it. If the answer is "maybe" or "not sure" → do NOT report it.
7. Ask yourself "Does this concern actually apply to THIS type of project?" (see Repository Profile above). If not → do NOT report it.
8. Returning zero findings is a VALID and GOOD outcome. Do not pad with uncertain concerns.

## INVESTIGATION REQUIREMENTS
- Use repository navigation tools before reporting findings.
- Treat seed files as a starting point, not the complete picture.
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
- Do NOT report findings in documentation files (.md, .txt, .rst), template files, example files, or reviewer instruction files that DESCRIBE patterns rather than implement them. A ".md" file that documents "you should avoid doing X" is not itself a code defect — only report findings in actual source code, configuration, or build files where the problem concretely manifests.

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
      "evidence": ["<exact quoted code that proves the problem>"],
      "applicabilityNote": "<one sentence: why does this specific finding apply to THIS codebase, not just in general>",
      "recommendation": "<specific actionable fix>",
      "tags": ["<optional tags>"]
    }
  ]
}
\`\`\`

Rules:
- score reflects overall category health (100 = perfect, 0 = critically broken)
- Only report findings supported by evidence you read in the current repository
- Findings must be actionable within this repository; do not report generic best-practice wishes without a concrete target
- filePath must be the exact relative path from the repo root
- startLine and endLine must be accurate line numbers from the provided code
- confidence is your certainty this is a real issue (0.0 to 1.0). Be honest: if you are not sure, use a low value or omit the finding
- evidence must contain exact code quoted from the file, not paraphrases or descriptions
- applicabilityNote must explain why THIS codebase has this problem (not just "this is a best practice")
- Return ONLY the JSON, no prose before or after
- The reviewer ID prefix for finding IDs is: ${reviewerId.toUpperCase().replace(/-/g, '_')}`;
}

export function buildAuditUserMessage(
  seedFiles: string[],
  totalFiles: number,
  seedFileCount: number,
  scopedFileCount: number,
  additionalContext?: string,
): string {
  const seedList = seedFiles.length > 0
    ? seedFiles.map(filePath => `- ${filePath}`).join('\n')
    : '- No seed files were selected';

  return `## Repository Context
Total files in repository: ${totalFiles}
Files matching reviewer scope: ${scopedFileCount}
Seed files provided for analysis: ${seedFileCount}

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

CRITICAL OUTPUT RULE: Your ENTIRE response must be valid JSON. Start your response with { and end with }. Write NO text before or after the JSON. NO markdown code blocks. NO explanation. NO introduction sentences. If your response contains anything other than the JSON object, the system will crash and the audit will fail.

Your response must look exactly like this (replace the example values):
{
  "selectedReviewers": [
    {
      "reviewerId": "code-quality",
      "reason": "Repository contains TypeScript source files with complex functions that benefit from code quality review."
    },
    {
      "reviewerId": "api-security",
      "reason": "Repository makes external API calls and handles API keys that require security review."
    }
  ]
}`;
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
