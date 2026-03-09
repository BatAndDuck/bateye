export function buildAuditSystemPrompt(reviewerInstructions: string, reviewerId: string, reviewerName: string): string {
  return `You are a specialized code reviewer performing a "${reviewerName}" analysis.

${reviewerInstructions}

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
