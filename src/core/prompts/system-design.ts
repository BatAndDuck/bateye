export function buildServiceAnalysisSystemPrompt(): string {
  return `You are a software architect analyzing a code module or service.

Analyze the provided source files and return a structured service design document.

## Output Requirements

Return ONLY this JSON:
\`\`\`json
{
  "serviceId": "<kebab-case-id>",
  "name": "<human readable name>",
  "kind": "<service|module|library|app|worker|gateway|resource>",
  "resourceCategory": "<optional database|cache|queue|storage|vector-search|external-saas|external-api|internal-platform>",
  "purpose": "<one sentence description of what this does>",
  "responsibilities": ["<responsibility 1>", "..."],
  "capabilities": ["<user-facing or business capability 1>", "..."],
  "publicInterfaces": [
    {
      "type": "<http|graphql|event|queue|cron|db>",
      "name": "<interface name, e.g. POST /api/users>",
      "description": "<optional description>"
    }
  ],
  "integrations": [
    {
      "name": "<target system or service name>",
      "description": "<what this integration does, max 200 chars>",
      "internal": <true|false>,
      "category": "<optional database|cache|queue|storage|vector-search|external-saas|external-api|internal-platform>"
    }
  ],
  "dependencies": ["<other service/module names this depends on>"],
  "entities": [
    {
      "name": "<entity name>",
      "description": "<optional>",
      "fields": ["<optional field list>"]
    }
  ],
  "submodules": ["<inner code module or pattern, e.g. 'commands', 'queries', 'handlers', 'controllers', 'repositories', 'domain', 'user feature', 'auth feature'>"],
  "complexityScore": <1-10>,
  "risks": ["<risk 1>", "..."]
}
\`\`\`

Rules:
- serviceId must be kebab-case (e.g. "user-service", "auth-module")
- kind=resource is for infrastructure components such as databases, caches, brokers, storage, or other external runtime resources that are part of the solution architecture
- If you are in an agentic CLI environment, inspect the code deeply before answering and use extra research passes/subagents when useful
- List only actual dependencies evident in the code
- Public interfaces are externally visible APIs, events, or data sources
- integrations: concise explanation of why the integration exists; keep each description under 200 characters
- capabilities: concrete things the service enables, phrased as actions or outcomes
- submodules: list inner organizational units visible in the code — CQRS patterns (commands/queries), feature modules, architectural layers (controllers/services/repositories), domain aggregates, or named sub-packages. Leave empty array if no clear inner structure.
- complexityScore: 1–10 rating of this service's overall complexity. Consider: number of files, depth of logic, number of integrations, patterns used (1=trivial config/static, 5=moderate CRUD service, 10=complex distributed coordinator).
- Risks are architectural or operational concerns`;
}

export function buildServiceAnalysisUserMessage(
  serviceName: string,
  filesContext: string,
  analysisHints: string[] = []
): string {
  const hintsBlock = analysisHints.length > 0
    ? `## Detected Hints

${analysisHints.map(hint => `- ${hint}`).join('\n')}

`
    : '';

  return `## Service / Module: ${serviceName}

${hintsBlock}## Source Files

${filesContext}

Analyze this service/module and return the JSON document.`;
}

export function buildRelevantFileSelectionSystemPrompt(): string {
  return `You are selecting all repository files relevant to understanding one architectural unit.

Return ONLY valid JSON:
\`\`\`json
{
  "filePaths": ["<relative path>", "..."],
  "reasons": ["<why additional files were selected>", "..."],
  "confidence": <0-1>,
  "gaps": ["<what may still be missing>", "..."]
}
\`\`\`

Rules:
- Prefer recall over brevity: include every file that is plausibly useful for understanding this unit's controllers, frontend, dependencies, integrations, domain models, configuration, infra, and interfaces.
- You are choosing from the provided repository inventory. Do not invent file paths.
- Include files outside the obvious unit directory when they materially affect the unit.
- confidence reflects how complete the selected set appears.`;
}

export function buildRelevantFileSelectionUserMessage(
  unitName: string,
  unitHints: string[],
  selectedFiles: string[],
  allRepoFiles: string[],
): string {
  return `## Unit
${unitName}

## Hints
${unitHints.length > 0 ? unitHints.map(hint => `- ${hint}`).join('\n') : '- No hints'}

## Already Selected Files
${selectedFiles.length > 0 ? selectedFiles.map(file => `- ${file}`).join('\n') : '- None'}

## Repository Inventory
${allRepoFiles.map(file => `- ${file}`).join('\n')}

Select every additional relevant file for this unit and return JSON only.`;
}

export function buildFileSummarySystemPrompt(): string {
  return `You are analyzing one source file as part of software architecture reconstruction.

Return ONLY valid JSON:
\`\`\`json
{
  "summary": "<1-3 sentence summary of the file's architectural role>",
  "interfaces": [
    {
      "type": "<http|graphql|event|queue|cron|db>",
      "name": "<interface name>",
      "description": "<optional>"
    }
  ],
  "integrations": [
    {
      "name": "<integration or resource name>",
      "description": "<short explanation>",
      "internal": <true|false>,
      "category": "<optional database|cache|queue|storage|vector-search|external-saas|external-api|internal-platform>",
      "instanceKey": "<optional stable identifier if this is a distinct instance>"
    }
  ],
  "dependencies": ["<internal dependency>", "..."],
  "entities": [
    {
      "name": "<entity name>",
      "description": "<optional>",
      "fields": ["<optional field>", "..."]
    }
  ],
  "submodules": ["<submodule hint>", "..."],
  "capabilities": ["<capability>", "..."],
  "importance": <1-10>
}
\`\`\`

Rules:
- Focus on what the file contributes architecturally.
- Include integrations only when supported by code or config in this file.
- Use \`instanceKey\` only when the file clearly points to a distinct resource instance or endpoint.
- Keep descriptions short and concrete.`;
}

export function buildFileSummaryUserMessage(
  serviceName: string,
  filePath: string,
  fileContent: string,
  analysisHints: string[] = [],
): string {
  const hintsBlock = analysisHints.length > 0
    ? `## Hints

${analysisHints.map(hint => `- ${hint}`).join('\n')}

`
    : '';

  return `## Service
${serviceName}

## File
${filePath}

${hintsBlock}## Content

${fileContent}

Summarize this file and return JSON only.`;
}

export function buildServiceSynthesisFromFilesSystemPrompt(): string {
  return `You are synthesizing one service from per-file architecture summaries.

Return ONLY valid JSON matching the service design document schema already used by the system design command.

Rules:
- Use the file summaries as the source of truth.
- Merge duplicate integrations when they refer to the same thing.
- Keep distinct integration instances separate when instance keys or descriptions indicate they are different.
- Prefer completeness over brevity.`;
}

export function buildServiceSynthesisFromFilesUserMessage(
  serviceName: string,
  analysisHints: string[],
  fileSummaries: string,
): string {
  const hintsBlock = analysisHints.length > 0
    ? `## Service Hints

${analysisHints.map(hint => `- ${hint}`).join('\n')}

`
    : '';

  return `## Service
${serviceName}

${hintsBlock}## File Summaries

${fileSummaries}

Synthesize the service and return JSON only.`;
}

export function buildSystemSynthesisSystemPrompt(): string {
  return `You are a software architect synthesizing an overall system architecture analysis.

Return ONLY valid JSON:
\`\`\`json
{
  "architectureType": "<monolith|modular-monolith|distributed-monolith|microservices|hybrid-service-oriented|event-driven-hybrid>",
  "score": <0-100>,
  "strengths": ["<strength>", "..."],
  "weaknesses": ["<weakness>", "..."],
  "globalSummary": "<2-3 paragraph summary of the verified architecture and confidence>"
}
\`\`\`

Use the coverage and gaps metadata. Do not hide uncertainty.`;
}

export function buildSystemSynthesisUserMessage(
  services: import('../../types/index').ServiceDesignDoc[],
  repoStructure: string,
  coverage?: import('../../types/index').SystemDesignResult['coverage'],
): string {
  return `## Repository Structure
${repoStructure}

## Coverage
${coverage ? JSON.stringify(coverage, null, 2) : 'No coverage data'}

## Verified Units
${services.map(service => JSON.stringify(service, null, 2)).join('\n\n---\n\n')}

Synthesize the overall architecture and return JSON only.`;
}
