export function buildAuditSystemPrompt(reviewerInstructions: string, reviewerId: string, reviewerName: string): string {
  return `You are a specialized code reviewer performing a "${reviewerName}" analysis.

${reviewerInstructions}

## SCOPE DISCIPLINE
Only report findings within your specific area of expertise described above. Do NOT report issues that belong to other reviewer specializations (e.g., a Security reviewer should not report code style issues; a Performance reviewer should not report missing auth).

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
- Only report findings that are supported by evidence in the provided code
- filePath must be the exact relative path from the repo root
- startLine and endLine must be accurate line numbers from the provided code
- confidence is your certainty that this is a real issue (0.0 to 1.0)
- Return ONLY the JSON, no prose before or after
- The reviewer ID prefix for finding IDs is: ${reviewerId.toUpperCase().replace(/-/g, '_')}`;
}

export function buildAuditUserMessage(
  filesContext: string,
  totalFiles: number,
  scopedFiles: number
): string {
  return `## Repository Context
Total files in repository: ${totalFiles}
Files provided for analysis: ${scopedFiles}

## Files to Analyze

${filesContext}

Analyze the code above according to your reviewer instructions. Return the JSON result.`;
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
- Prefer breadth over depth — when in doubt, include the reviewer
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
