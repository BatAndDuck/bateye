export function buildServiceAnalysisSystemPrompt(): string {
  return `You are a software architect analyzing a code module or service.

Analyze the provided source files and return a structured service design document.

## Output Requirements

Return ONLY this JSON:
\`\`\`json
{
  "serviceId": "<kebab-case-id>",
  "name": "<human readable name>",
  "kind": "<service|module|library|app|worker|gateway>",
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
  "risks": ["<risk 1>", "..."]
}
\`\`\`

Rules:
- serviceId must be kebab-case (e.g. "user-service", "auth-module")
- List only actual dependencies evident in the code
- Public interfaces are externally visible APIs, events, or data sources
- Risks are architectural or operational concerns`;
}

export function buildServiceAnalysisUserMessage(serviceName: string, filesContext: string): string {
  return `## Service / Module: ${serviceName}

## Source Files

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
