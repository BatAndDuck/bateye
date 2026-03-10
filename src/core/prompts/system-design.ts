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
  "purpose": "<one sentence description of what this does>",
  "responsibilities": ["<responsibility 1>", "..."],
  "publicInterfaces": [
    {
      "type": "<http|graphql|event|queue|cron|db>",
      "name": "<interface name, e.g. POST /api/users>",
      "description": "<optional description>"
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
- List only actual dependencies evident in the code
- Public interfaces are externally visible APIs, events, or data sources
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

export function buildSystemSynthesisSystemPrompt(): string {
  return `You are a software architect synthesizing an overall system architecture analysis.

Given individual service/module analyses, describe the overall system architecture.

## Output Requirements

Return ONLY this JSON:
\`\`\`json
{
  "architectureType": "<monolith|modular-monolith|distributed-monolith|microservices|hybrid-service-oriented|event-driven-hybrid>",
  "score": <0-100>,
  "strengths": ["<strength 1>", "..."],
  "weaknesses": ["<weakness 1>", "..."],
  "globalSummary": "<2-3 paragraph summary of the architecture>"
}
\`\`\`

Architecture type definitions:
- monolith: single deployable unit, tightly coupled
- modular-monolith: single deployment but well-structured modules
- distributed-monolith: multiple services but tightly coupled
- microservices: independent services with clear boundaries
- hybrid-service-oriented: mix of monolith and services
- event-driven-hybrid: event-driven with some synchronous services

Score: 100 = excellent architecture, 0 = severely problematic`;
}

export function buildSystemSynthesisUserMessage(
  services: import('../../types/index').ServiceDesignDoc[],
  repoStructure: string
): string {
  return `## Repository Structure
${repoStructure}

## Service Analyses
${services.map(s => JSON.stringify(s, null, 2)).join('\n\n---\n\n')}

Synthesize the overall architecture and return the JSON result.`;
}
