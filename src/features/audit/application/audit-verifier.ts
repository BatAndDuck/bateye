import * as fs from 'fs';
import * as path from 'path';
import { z } from 'zod';
import { Finding } from '../../../types/index';
import { IRuntime } from '../../../core/runtime/interface';
import { formatErrorWithCauses } from '../../../core/runtime/error-format';
import { logPrompt } from '../../../core/output/prompt-logger';
import { resolveDiagnosticDir } from '../../../core/output/diagnostics';

const BATCH_SIZE = 5;
const AUDIT_VERIFIER_TIMEOUT_MS = 180_000;
const AUDIT_VERIFIER_MAX_TOKENS = 1024;
// Extra lines of context to show above/below the reported range so the verifier
// can see WHERE the flagged values come from (e.g. function parameters, callers).
const CONTEXT_LINES_BEFORE = 30;
const CONTEXT_LINES_AFTER = 10;

// ---------- Prompt builders ----------

function buildVerifierSystemPrompt(): string {
  return `You are a strict false-positive detector for code review findings. Your job is to decide whether each proposed finding is backed by concrete evidence in the actual code shown.

## Your task
For each finding in the batch:
1. Read ALL the code shown - the wider context above and below the flagged lines is critical.
2. Ask: "Does the actual code at this file/line prove that this specific problem EXISTS and is HARMFUL in this codebase?"
3. Classify the finding as one of:
   - concrete: The code shown directly demonstrates the reported problem. A developer would immediately agree this is a real, actionable issue.
   - speculative: The finding describes a theoretical concern, a generic best practice, or a policy that lacks concrete evidence of harm in the actual code shown.
   - inapplicable: The finding applies an enterprise/web-service concept to a codebase that is clearly a local CLI tool, library, or developer utility where that concept is irrelevant.

## Classification rules - read ALL before deciding

### Injection / prompt injection false positives
- If the finding flags string interpolation as "injection risk" or "prompt injection", look at WHERE the interpolated values come from in the wider code context shown:
  - Values loaded from local files bundled with the application (reviewer instructions, templates, config files) → speculative. These are static trusted content, not user input.
  - Values from parameters that are populated by loading local .md or .json files at startup → speculative.
  - Only classify as concrete if the interpolated value demonstrably comes from external user input, a network response, or an untrusted third-party source that could contain malicious content.
- If the code is a developer CLI tool that generates prompts from its own static template files, those template values are NOT attack vectors. → speculative.

### Algorithmic complexity false positives
- If the finding flags O(n²) or quadratic complexity:
  - Look at the ACTUAL data: is it clearly a small bounded dataset (e.g. SVG diagram rendering, config arrays, UI node lists with typically < 100 items)? → speculative. Performance problems require realistic input sizes that would cause measurable harm.
  - O(1) Map/dict lookups (Map.get, object[key]) flagged as O(n) → speculative.
  - Only concrete if the actual production input can grow unboundedly and the nested loops would cause real slowness.

### Other rules
- If the code is correct and the finding is based on a generic best practice without concrete evidence of harm → speculative
- If the finding requires an operational concept (audit logs, actor identity, compliance trail) but the project is a local dev tool → inapplicable
- If the finding flags a working safety guard as "unsafe" → speculative
- If the code is clearly intentional (masked secrets, single-result files, self-dogfooding CI) → speculative
- Only classify as concrete when the evidence is unambiguous and the problem is specific to the lines shown

## Output format
CRITICAL: Your ENTIRE response must be valid JSON. Start with { and end with }. No text before or after.

{
  "verifications": [
    { "findingId": "<id>", "classification": "concrete", "reason": "<one sentence why>" },
    { "findingId": "<id>", "classification": "speculative", "reason": "<one sentence why not>" }
  ]
}

The array must contain exactly one entry per finding in the input, in the same order.`;
}

function buildVerifierUserMessage(
  batch: Array<{ finding: Finding; codeContext: string }>,
): string {
  const items = batch.map(({ finding, codeContext }, i) => {
    return `### Finding ${i + 1} - id: "${finding.id}"
Title: ${finding.title}
Priority: ${finding.priority}
File: ${finding.filePath}:${finding.startLine}-${finding.endLine}
Description: ${finding.description}
Evidence (from reviewer): ${finding.evidence.join('; ')}
Applicability note (from reviewer): ${finding.applicabilityNote || '(not provided)'}

#### Actual code at that location:
\`\`\`
${codeContext}
\`\`\``;
  });

  return `${items.join('\n\n---\n\n')}

---

IMPORTANT: The code context shown includes wider surrounding lines (marked with >>> for the exact flagged lines).
Use the full context to determine WHERE variables come from - this is essential for correctly classifying injection and complexity findings.

Classify each finding. Return JSON with ${batch.length} verification entries.`;
}

// ---------- Zod schema ----------

const verificationBatchSchema = z.object({
  verifications: z.array(z.object({
    findingId: z.string(),
    classification: z.enum(['concrete', 'speculative', 'inapplicable']),
    reason: z.string(),
  })),
});

// ---------- Helpers ----------

function readCodeContext(repoPath: string, filePath: string, startLine: number, endLine: number): string {
  try {
    const absolutePath = path.resolve(repoPath, filePath);
    const content = fs.readFileSync(absolutePath, 'utf-8');
    const lines = content.split('\n');
    // Expand context significantly so the verifier can see WHERE inputs come from
    // (e.g. function parameters, import sources, callers above the flagged lines).
    const contextStart = Math.max(0, startLine - CONTEXT_LINES_BEFORE);
    const contextEnd = Math.min(lines.length - 1, endLine + CONTEXT_LINES_AFTER);

    return lines
      .slice(contextStart, contextEnd + 1)
      .map((line, i) => {
        const lineNum = contextStart + i + 1;
        const marker = (lineNum >= startLine && lineNum <= endLine) ? '>>>' : '   ';
        return `${marker} ${lineNum}: ${line}`;
      })
      .join('\n');
  } catch {
    return '(file not readable)';
  }
}

// ---------- Main export ----------

export interface AuditVerifierOptions {
  repoPath: string;
  model: string;
  apiKey: string;
  transport?: string;
  apiBaseUrl?: string;
  runtime: IRuntime;
  log?: (msg: string) => void;
}

export interface AuditVerifierResult {
  kept: Finding[];
  rejected: Array<{ finding: Finding; classification: 'speculative' | 'inapplicable'; reason: string }>;
}

/**
 * Skeptic verification pass for audit findings.
 *
 * Modelled on the PR review semantic verifier. After deduplication, batches
 * findings and asks an LLM to classify each as concrete, speculative, or
 * inapplicable. Speculative and inapplicable findings are dropped.
 */
export async function verifyAuditFindings(
  findings: Finding[],
  options: AuditVerifierOptions,
): Promise<AuditVerifierResult> {
  const { repoPath, model, apiKey, transport, apiBaseUrl, runtime, log } = options;

  if (findings.length === 0) {
    return { kept: [], rejected: [] };
  }

  const kept: Finding[] = [];
  const rejected: AuditVerifierResult['rejected'] = [];
  const diagnosticDir = resolveDiagnosticDir(repoPath);

  const systemPrompt = buildVerifierSystemPrompt();

  // Process in batches
  for (let batchStart = 0; batchStart < findings.length; batchStart += BATCH_SIZE) {
    const batch = findings.slice(batchStart, batchStart + BATCH_SIZE);
    const batchNumber = Math.floor(batchStart / BATCH_SIZE) + 1;
    const batchWithContext = batch.map(finding => ({
      finding,
      codeContext: readCodeContext(repoPath, finding.filePath, finding.startLine, finding.endLine),
    }));

    const userMessage = buildVerifierUserMessage(batchWithContext);
    const startedAt = Date.now();

    if (diagnosticDir) {
      logPrompt(diagnosticDir, `audit-verifier-batch${batchNumber}`, systemPrompt, userMessage);
    }

    log?.(
      `  [audit-verifier] Batch ${batchNumber}: ${batch.length} finding(s), `
      + `prompt=${systemPrompt.length + userMessage.length} chars, `
      + `timeout=${Math.round(AUDIT_VERIFIER_TIMEOUT_MS / 1000)}s${diagnosticDir ? `, diagnostics=${diagnosticDir}` : ''}`,
    );

    try {
      const result = await runtime.run(
        {
          systemPrompt,
          userMessage,
          model,
          apiKey,
          transport,
          apiBaseUrl,
          callLabel: `audit-verifier (batch ${batchNumber})`,
          cwd: repoPath,
          maxTokens: AUDIT_VERIFIER_MAX_TOKENS,
          temperature: 0,
          timeoutMs: AUDIT_VERIFIER_TIMEOUT_MS,
        },
        verificationBatchSchema,
      );

      log?.(
        `  [audit-verifier] Batch ${batchNumber} completed in `
        + `${((Date.now() - startedAt) / 1000).toFixed(1)}s`,
      );

      const { verifications } = result.data;
      const verificationMap = new Map(verifications.map(v => [v.findingId, v]));

      for (const finding of batch) {
        const verification = verificationMap.get(finding.id);
        if (!verification || verification.classification === 'concrete') {
          kept.push(finding);
        } else {
          rejected.push({
            finding,
            classification: verification.classification,
            reason: verification.reason,
          });
          log?.(`  [audit-verifier] Dropped "${finding.title}" (${finding.filePath}:${finding.startLine}) - ${verification.classification}: ${verification.reason}`);
        }
      }
    } catch (err) {
      // If verifier fails, keep all findings in this batch (fail-safe)
      log?.(`  [audit-verifier] Warning: verifier failed for batch, keeping all ${batch.length} findings: ${formatErrorWithCauses(err)}`);
      kept.push(...batch);
    }
  }

  return { kept, rejected };
}
