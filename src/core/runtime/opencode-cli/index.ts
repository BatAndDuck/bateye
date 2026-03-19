import { spawn } from 'child_process';
import { createServer, AddressInfo } from 'net';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { AgenticRepositoryReviewOptions, IRuntime, RunOptions, RunResult, TokenUsage, resolveModelTarget } from '../interface';
import { logRuntimeDebug } from '../debug';
import { formatErrorWithCauses } from '../error-format';
import { buildOpenCodeEnvironment, resolveOpenCodeInvocation } from './command';
import { buildStructureRepairPrompt, formatZodErrors, tryParseAndValidate } from '../structure-repair';

type OpenCodeServerHandle = {
  url: string;
  child: ReturnType<typeof spawn>;
  envSignature: string;
  /** Absolute path to the opencode SQLite database used by this server instance. */
  dbPath: string;
  logPath: string;
  close: () => void;
};

interface SessionTokenStats {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  cost: number;
}

type DatabaseSyncLike = {
  prepare(sql: string): { get: (...args: unknown[]) => unknown };
  close(): void;
};

/**
 * Query the opencode SQLite database for exact per-step token usage of a completed session.
 * Uses node:sqlite (built-in since Node 22, experimental). Falls back to null on any error.
 *
 * Retries up to 3 times with 200ms delay to handle WAL lock contention when many reviewer
 * sessions complete in parallel and race to open the same DB file.
 * Does NOT use readOnly mode because on Windows the .db-shm shared-memory file needs write
 * access even for read-only workloads in WAL mode, which can cause spurious SQLITE_CANTOPEN.
 */
function querySessionActualUsage(dbPath: string, sessionId: string): SessionTokenStats | null {
  const nodeSqlite = loadNodeSqlite();
  if (!nodeSqlite) {
    return null; // node:sqlite not available (Node < 22)
  }
  const { DatabaseSync } = nodeSqlite;

  const SQL = `
    SELECT
      COALESCE(SUM(json_extract(data, '$.tokens.input')), 0)         AS input_tokens,
      COALESCE(SUM(json_extract(data, '$.tokens.output')), 0)        AS output_tokens,
      COALESCE(SUM(json_extract(data, '$.tokens.cache.read')), 0)    AS cache_read_tokens,
      COALESCE(SUM(json_extract(data, '$.tokens.cache.write')), 0)   AS cache_write_tokens,
      COALESCE(SUM(json_extract(data, '$.cost')), 0)                 AS cost
    FROM part
    WHERE session_id = ?
      AND json_extract(data, '$.type') = 'step-finish'
  `;

  const MAX_ATTEMPTS = 3;
  const RETRY_DELAY_MS = 200;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    // Synchronous sleep for retry — we're already in a synchronous helper.
    if (attempt > 0) {
      const deadline = Date.now() + RETRY_DELAY_MS;
      while (Date.now() < deadline) { /* spin */ }
    }

    let db: DatabaseSyncLike | null = null;
    try {
      db = new DatabaseSync(dbPath);
      const result = db.prepare(SQL).get(sessionId) as {
        input_tokens: number;
        output_tokens: number;
        cache_read_tokens: number;
        cache_write_tokens: number;
        cost: number;
      } | undefined;

      if (!result || (result.input_tokens === 0 && result.output_tokens === 0 && result.cost === 0)) {
        return null; // No step-finish parts found for this session
      }

      return {
        inputTokens: result.input_tokens,
        outputTokens: result.output_tokens,
        cacheReadTokens: result.cache_read_tokens,
        cacheWriteTokens: result.cache_write_tokens,
        cost: result.cost,
      };
    } catch (err) {
      if (attempt === MAX_ATTEMPTS - 1) {
        // Log only on final failure so users know the token data is estimated.
        logRuntimeDebug(`[opencode] DB token query failed after ${MAX_ATTEMPTS} attempts (path: ${dbPath}, session: ${sessionId}): ${(err as Error).message ?? String(err)}`);
      }
    } finally {
      try { db?.close(); } catch { /* ignore close errors */ }
    }
  }

  return null;
}

function loadNodeSqlite(): { DatabaseSync: new (path: string) => DatabaseSyncLike } | null {
  const originalEmitWarning = process.emitWarning as (...args: unknown[]) => void;
  process.emitWarning = ((warning: unknown, ...args: unknown[]) => {
    const warningType = typeof args[0] === 'string'
      ? args[0]
      : typeof args[0] === 'object' && args[0] !== null && 'type' in args[0]
        ? String((args[0] as { type?: unknown }).type ?? '')
        : '';
    const message = warning instanceof Error ? warning.message : String(warning);

    if (warningType === 'ExperimentalWarning' && /SQLite is an experimental feature/i.test(message)) {
      return;
    }

    originalEmitWarning(warning, ...args);
  }) as typeof process.emitWarning;

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('node:sqlite') as { DatabaseSync: new (path: string) => DatabaseSyncLike };
  } catch {
    return null;
  } finally {
    process.emitWarning = originalEmitWarning as typeof process.emitWarning;
  }
}

const MAX_STRUCTURED_OUTPUT_ATTEMPTS = 2;
const OPEN_CODE_STRUCTURED_OUTPUT_RETRY_COUNT = 1;

type OpenCodeSession = {
  id: string;
};

type OpenCodeMessagePart =
  | { type: 'text'; text: string }
  | {
      type: 'tool';
      tool?: string;
      state?: {
        input?: unknown;
        metadata?: {
          valid?: boolean;
        };
      };
    }
  | { type: string; [key: string]: unknown };

type OpenCodeMessageResponse = {
  info: {
    structured?: unknown;
    structured_output?: unknown;
    error?: {
      message?: string;
      data?: {
        message?: string;
      };
    };
    /** Some OpenCode providers report cumulative session token usage here */
    usage?: {
      inputTokens?: number;
      outputTokens?: number;
      input_tokens?: number;
      output_tokens?: number;
    };
  };
  parts: OpenCodeMessagePart[];
};

let activeServerPromise: Promise<OpenCodeServerHandle> | null = null;
let activeServerSignature: string | null = null;
let shutdownHooksRegistered = false;

/**
 * Attempts to extract cumulative token usage from an OpenCode message response.
 * OpenCode may include usage in `info.usage` or in parts with type `step-finish`.
 * Returns null if no actual usage data is available.
 */
function extractActualUsage(response: OpenCodeMessageResponse): { inputTokens: number; outputTokens: number } | null {
  // Check info-level usage (some providers expose this)
  const infoUsage = response.info?.usage;
  if (infoUsage) {
    const input = infoUsage.inputTokens ?? infoUsage.input_tokens;
    const output = infoUsage.outputTokens ?? infoUsage.output_tokens;
    if (typeof input === 'number' && typeof output === 'number' && (input > 0 || output > 0)) {
      return { inputTokens: input, outputTokens: output };
    }
  }

  // Check parts for step-finish or usage-report parts
  let totalInput = 0;
  let totalOutput = 0;
  let found = false;
  for (const part of response.parts) {
    const p = part as Record<string, unknown>;
    // step-finish parts carry per-turn usage in some providers
    if (p.type === 'step-finish' || p.type === 'usage') {
      const usage = p.usage as Record<string, unknown> | undefined;
      if (usage) {
        const input = (usage.inputTokens ?? usage.input_tokens) as number | undefined;
        const output = (usage.outputTokens ?? usage.output_tokens) as number | undefined;
        if (typeof input === 'number') { totalInput += input; found = true; }
        if (typeof output === 'number') { totalOutput += output; found = true; }
      }
    }
  }
  return found ? { inputTokens: totalInput, outputTokens: totalOutput } : null;
}

function extractJson(rawText: string): string {
  const jsonMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)```/) ||
    rawText.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
  return jsonMatch ? jsonMatch[1].trim() : rawText.trim();
}

function summarizeSdkError(err: unknown): string {
  const candidate = err as { data?: unknown; error?: unknown };
  if (candidate?.error) return JSON.stringify(candidate.error);
  if (candidate?.data) return JSON.stringify(candidate.data);
  return formatErrorWithCauses(err);
}

function formatValidationFeedback(err: unknown): string {
  if (err instanceof z.ZodError) {
    return err.issues
      .slice(0, 8)
      .map(issue => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ');
  }

  if (err instanceof Error) {
    return err.message;
  }

  return String(err);
}

function shouldRetryStructuredOutput(err: unknown, attempt: number): boolean {
  if (attempt >= MAX_STRUCTURED_OUTPUT_ATTEMPTS - 1) {
    return false;
  }

  return err instanceof z.ZodError
    || err instanceof SyntaxError
    || (err instanceof Error && /no structured text response/i.test(err.message));
}

export function buildStructuredOutputSchema(schema: z.ZodTypeAny): Record<string, unknown> {
  const buildJsonSchema = zodToJsonSchema as unknown as (
    input: z.ZodTypeAny,
    options: Record<string, unknown>,
  ) => Record<string, unknown>;

  const jsonSchema = buildJsonSchema(schema, {
    $refStrategy: 'none',
    target: 'jsonSchema7',
  });

  delete jsonSchema.$schema;
  delete jsonSchema.definitions;

  return jsonSchema;
}

export function extractStructuredOutput(response: OpenCodeMessageResponse): unknown {
  if (response.info.structured_output !== undefined) {
    return response.info.structured_output;
  }

  if (response.info.structured !== undefined) {
    return response.info.structured;
  }

  for (const part of response.parts) {
    if (part.type !== 'tool' || part.tool !== 'StructuredOutput') {
      continue;
    }

    const state = part.state as {
      input?: unknown;
      metadata?: {
        valid?: boolean;
      };
    } | undefined;

    if (state?.metadata?.valid && state.input !== undefined) {
      return state.input;
    }
  }

  return undefined;
}

export function coerceReviewerPayload(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(coerceReviewerPayload);
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  const record = value as Record<string, unknown>;
  const coerced: Record<string, unknown> = {};

  for (const [key, raw] of Object.entries(record)) {
    if (typeof raw === 'string') {
      const trimmed = raw.trim();

      if (['score', 'confidence', 'startLine', 'endLine', 'startColumn', 'endColumn'].includes(key)) {
        const numeric = Number(trimmed);
        if (!Number.isNaN(numeric)) {
          coerced[key] = numeric;
          continue;
        }
      }

      if (
        ['findings', 'evidence', 'tags', 'verificationTrail', 'searchedFor'].includes(key)
        && (trimmed.startsWith('[') || trimmed.startsWith('{'))
      ) {
        try {
          coerced[key] = coerceReviewerPayload(JSON.parse(trimmed));
          continue;
        } catch {
          // Fall through to keep the original string.
        }
      }
    }

    coerced[key] = coerceReviewerPayload(raw);
  }

  return coerced;
}

function asTrimmedString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function asStringArray(value: unknown): string[] | undefined {
  if (Array.isArray(value)) {
    const items = value
      .map(item => asTrimmedString(item))
      .filter((item): item is string => Boolean(item));

    return items.length > 0 ? items : undefined;
  }

  const single = asTrimmedString(value);
  return single ? [single] : undefined;
}

function asNumericValue(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  const stringValue = asTrimmedString(value);
  if (!stringValue) {
    return undefined;
  }

  const numeric = Number(stringValue);
  return Number.isFinite(numeric) ? numeric : undefined;
}

function mapPriorityAlias(value: unknown): string | undefined {
  const normalized = asTrimmedString(value)?.toLowerCase();
  if (!normalized) {
    return undefined;
  }

  switch (normalized) {
    case 'critical':
    case 'high':
    case 'medium':
    case 'low':
    case 'info':
      return normalized;
    case 'severe':
    case 'blocker':
      return 'critical';
    case 'warning':
      return 'medium';
    default:
      return undefined;
  }
}

function deriveTitleFromDescription(description: string | undefined): string | undefined {
  if (!description) {
    return undefined;
  }

  const title = description
    .split(/[\r\n.!?]/, 1)[0]
    .trim();

  return title ? title.slice(0, 100) : undefined;
}

function repairReviewerFindingShape(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return value;
  }

  const record = value as Record<string, unknown>;
  const description = asTrimmedString(record.description)
    || asTrimmedString(record.details)
    || asTrimmedString(record.explanation)
    || asTrimmedString(record.reason);
  const title = asTrimmedString(record.title)
    || asTrimmedString(record.name)
    || asTrimmedString(record.issue)
    || asTrimmedString(record.headline)
    || deriveTitleFromDescription(description);
  const evidence = asStringArray(record.evidence)
    || asStringArray(record.examples)
    || asStringArray(record.proof)
    || asStringArray(record.references);
  const recommendation = asTrimmedString(record.recommendation)
    || asTrimmedString(record.fix)
    || asTrimmedString(record.suggestion)
    || asTrimmedString(record.remediation)
    || asTrimmedString(record.action)
    || (title ? `Review: ${title}` : 'Review this finding.');
  const filePath = asTrimmedString(record.filePath)
    || asTrimmedString(record.path)
    || asTrimmedString(record.file)
    || asTrimmedString(record.filename);
  const rawStartLine = asNumericValue(record.startLine)
    || asNumericValue(record.line)
    || asNumericValue(record.lineNumber);
  const rawEndLine = asNumericValue(record.endLine) || rawStartLine;
  const startLine = rawStartLine !== undefined && rawEndLine !== undefined
    ? Math.min(rawStartLine, rawEndLine)
    : rawStartLine;
  const endLine = rawStartLine !== undefined && rawEndLine !== undefined
    ? Math.max(rawStartLine, rawEndLine)
    : rawEndLine;
  const rawStartColumn = asNumericValue(record.startColumn)
    || asNumericValue(record.column)
    || asNumericValue(record.columnNumber);
  const rawEndColumn = asNumericValue(record.endColumn) || rawStartColumn;
  const startColumn = rawStartColumn !== undefined && rawEndColumn !== undefined
    ? Math.min(rawStartColumn, rawEndColumn)
    : rawStartColumn;
  const endColumn = rawStartColumn !== undefined && rawEndColumn !== undefined
    ? Math.max(rawStartColumn, rawEndColumn)
    : rawEndColumn;
  const confidence = asNumericValue(record.confidence) || asNumericValue(record.certainty);
  const priority = mapPriorityAlias(record.priority) || mapPriorityAlias(record.severity);

  return {
    ...record,
    ...(title ? { title } : {}),
    ...(description ? { description } : {}),
    ...(priority ? { priority } : {}),
    ...(confidence !== undefined ? { confidence } : {}),
    ...(filePath ? { filePath } : {}),
    ...(startLine !== undefined ? { startLine } : {}),
    ...(endLine !== undefined ? { endLine } : {}),
    ...(startColumn !== undefined ? { startColumn } : {}),
    ...(endColumn !== undefined ? { endColumn } : {}),
    ...(evidence ? { evidence } : {}),
    ...(recommendation ? { recommendation } : {}),
  };
}

export function repairReviewerPayload(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return value;
  }

  const record = value as Record<string, unknown>;
  if (!Array.isArray(record.findings)) {
    return value;
  }

  return {
    ...record,
    findings: record.findings.map(repairReviewerFindingShape),
  };
}

export function serializeOpenCodeResponse(response: OpenCodeMessageResponse): string {
  const structuredOutput = extractStructuredOutput(response);
  if (structuredOutput !== undefined) {
    return JSON.stringify(structuredOutput);
  }

  return response.parts
    .filter((part): part is { type: 'text'; text: string } => part.type === 'text' && typeof part.text === 'string')
    .map(part => part.text)
    .join('\n')
    .trim();
}

function buildEnvSignature(env: NodeJS.ProcessEnv): string {
  return JSON.stringify({
    AI_GATEWAY_API_KEY: env.AI_GATEWAY_API_KEY || '',
    ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY || '',
    GEMINI_API_KEY: env.GEMINI_API_KEY || '',
    GOOGLE_API_KEY: env.GOOGLE_API_KEY || '',
    OPENAI_API_KEY: env.OPENAI_API_KEY || '',
    OPENAI_BASE_URL: env.OPENAI_BASE_URL || '',
    XDG_DATA_HOME: env.XDG_DATA_HOME || '',
  });
}

async function findAvailablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address() as AddressInfo | null;
      const port = address?.port;
      server.close(err => {
        if (err) {
          reject(err);
          return;
        }
        if (!port) {
          reject(new Error('Failed to allocate a local port for OpenCode server.'));
          return;
        }
        resolve(port);
      });
    });
  });
}

async function waitForServerReady(
  url: string,
  child: ReturnType<typeof spawn>,
  timeoutMs: number,
): Promise<void> {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    if (child.exitCode !== null) {
      throw new Error(`OpenCode server exited early with code ${child.exitCode}.`);
    }

    try {
      const response = await fetch(`${url}/global/health`);
      if (response.ok) {
        return;
      }
    } catch {
      // Server is still booting.
    }

    await new Promise(resolve => setTimeout(resolve, 250));
  }

  throw new Error(`OpenCode server did not become ready within ${timeoutMs}ms.`);
}

async function startServer(env: NodeJS.ProcessEnv, readinessTimeoutMs = 30_000): Promise<OpenCodeServerHandle> {
  const port = await findAvailablePort();
  const invocation = resolveOpenCodeInvocation();
  const logPath = path.join(os.tmpdir(), `codeowl-opencode-${process.pid}-${Date.now()}-${port}.log`);
  const logFd = fs.openSync(logPath, 'a');
  const child = spawn(
    invocation.command,
    [...invocation.args, 'serve', '--hostname=127.0.0.1', `--port=${port}`],
    {
      cwd: process.cwd(),
      env,
      stdio: ['ignore', logFd, logFd],
      windowsHide: true,
    },
  );
  fs.closeSync(logFd);

  const url = `http://127.0.0.1:${port}`;

  try {
    await waitForServerReady(url, child, readinessTimeoutMs);
  } catch (err) {
    child.kill();
    const logTail = formatRecentServerLogs(logPath);
    throw new Error(
      `Failed to start OpenCode server at ${url}: ${formatErrorWithCauses(err)}${logTail ? ` | server logs: ${logTail}` : ''}`,
      { cause: err },
    );
  }

  child.unref();

  // Compute the DB path from the same XDG_DATA_HOME the server uses.
  const xdgDataHome = env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share');
  const dbPath = path.join(xdgDataHome, 'opencode', 'opencode.db');

  return {
    url,
    child,
    envSignature: buildEnvSignature(env),
    dbPath,
    logPath,
    close: () => {
      if (child.exitCode === null) {
        child.kill('SIGTERM');
      }
    },
  };
}

async function closeActiveServer(): Promise<void> {
  if (!activeServerPromise) {
    return;
  }

  try {
    const server = await activeServerPromise;
    server.close();
  } catch {
    // Ignore shutdown-time cleanup errors.
  } finally {
    activeServerPromise = null;
    activeServerSignature = null;
  }
}

function registerShutdownHooks(): void {
  if (shutdownHooksRegistered) {
    return;
  }

  shutdownHooksRegistered = true;

  const close = () => {
    void closeActiveServer();
  };

  process.once('beforeExit', close);
  process.once('exit', close);
  process.once('SIGINT', close);
  process.once('SIGTERM', close);
}

async function getServer(options: Pick<RunOptions, 'apiKey' | 'apiBaseUrl' | 'model' | 'transport'>): Promise<OpenCodeServerHandle> {
  registerShutdownHooks();
  const env = buildOpenCodeEnvironment(process.env, options);
  const envSignature = buildEnvSignature(env);

  if (activeServerPromise && activeServerSignature === envSignature) {
    return activeServerPromise;
  }

  if (activeServerPromise && activeServerSignature !== envSignature) {
    await closeActiveServer();
  }

  activeServerSignature = envSignature;
  activeServerPromise = startServer(env);
  return activeServerPromise;
}

export class OpenCodeCLIRuntime implements IRuntime {
  async isAvailable(): Promise<boolean> {
    try {
      const invocation = resolveOpenCodeInvocation();
      const child = spawn(invocation.command, [...invocation.args, '--version'], {
        stdio: 'ignore',
        windowsHide: true,
      });
      await new Promise<void>((resolve, reject) => {
        child.once('exit', code => {
          if (code === 0) {
            resolve();
            return;
          }
          reject(new Error(`OpenCode exited with code ${code}`));
        });
        child.once('error', reject);
      });
      return true;
    } catch {
      return false;
    }
  }

  async run<T>(options: RunOptions, schema: z.ZodType<T, z.ZodTypeDef, unknown>): Promise<RunResult<T>> {
    return this.executePrompt(options, schema, options.cwd || process.cwd(), options.timeoutMs ?? 120_000);
  }

  async runAgenticReview<T>(options: AgenticRepositoryReviewOptions, schema: z.ZodType<T, z.ZodTypeDef, unknown>): Promise<RunResult<T>> {
    return this.executePrompt(options, schema, options.repoPath, options.timeoutMs || 150_000);
  }

  private async executePrompt<T>(
    options: RunOptions,
    schema: z.ZodType<T, z.ZodTypeDef, unknown>,
    cwd: string,
    timeoutMs: number,
  ): Promise<RunResult<T>> {
    const start = Date.now();
    const server = await getServer(options);
    const target = resolveModelTarget(options.model, options.transport);

    // DeepSeek thinking models (e.g. deepseek-v3.2-thinking) are incompatible with tool-calling
    // workflows: the model requires a `reasoning_content` field in every assistant message during
    // a multi-turn tool-call sequence, which OpenCode's agentic runner does not inject.
    // Strip the -thinking suffix so the non-thinking variant is used instead.
    if (target.modelId.endsWith('-thinking')) {
      const stripped = target.modelId.slice(0, -'-thinking'.length);
      logRuntimeDebug(`[opencode] Model "${target.modelId}" is a thinking model and cannot be used with tool calls. Switching to "${stripped}" automatically.`);
      target.modelId = stripped;
    }
    const responseSchema = buildStructuredOutputSchema(schema);
    const headers = {
      'content-type': 'application/json',
      'x-opencode-directory': cwd,
    };
    let lastError: unknown;
    let lastRawJson: string | null = null;
    // Estimate input tokens from prompt character lengths (1 token ≈ 4 chars)
    const estimatedInputTokens = Math.ceil((options.systemPrompt.length + options.userMessage.length) / 4);
    const callId = `${target.transport}/${target.modelId}`;

    const labelTag = options.callLabel ? ` [${options.callLabel}]` : '';
    logRuntimeDebug(`[opencode]${labelTag} Starting call: model=${callId}, systemPrompt=${options.systemPrompt.length} chars, userMessage=${options.userMessage.length} chars, estInputTokens=~${estimatedInputTokens}, timeout=${Math.round(timeoutMs / 1000)}s`);

    for (let attempt = 0; attempt < MAX_STRUCTURED_OUTPUT_ATTEMPTS; attempt++) {
      let sessionID: string | undefined;
      const validationRetryNote = attempt === 0
        ? ''
        : `\n\nPREVIOUS ATTEMPT FAILED STRUCTURED OUTPUT VALIDATION. Return ONLY JSON matching the requested schema with all required fields and correct value types. Validation issue: ${formatValidationFeedback(lastError)}`;

      if (attempt > 0) {
        logRuntimeDebug(`[opencode] Retry attempt ${attempt + 1}/${MAX_STRUCTURED_OUTPUT_ATTEMPTS} for ${callId}: previous error was ${summarizeSdkError(lastError)}`);
      }

      let serializedResponse = '';
      try {
        const session = await this.request<OpenCodeSession>(`${server.url}/session`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ title: 'CodeOwl Review Session' }),
        }, 30_000);
        sessionID = session.id;

        const response = await this.request<OpenCodeMessageResponse>(`${server.url}/session/${sessionID}/message`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            model: {
              providerID: target.transport,
              modelID: target.modelId,
            },
            format: {
              type: 'json_schema',
              name: 'CodeOwlResponse',
              schema: responseSchema,
              retryCount: OPEN_CODE_STRUCTURED_OUTPUT_RETRY_COUNT,
            },
            system: options.systemPrompt + validationRetryNote,
            parts: [{ type: 'text', text: options.userMessage }],
          }),
        }, timeoutMs);

        const providerError = response?.info?.error?.data?.message || response?.info?.error?.message;
        if (providerError) {
          throw new Error(providerError);
        }

        if (!response?.info || !response?.parts) {
          throw new Error(
            `OpenCode returned an invalid response structure (info=${typeof response?.info}, parts=${typeof response?.parts}). `
            + `Model: ${target.transport}/${target.modelId}. Raw: ${JSON.stringify(response).slice(0, 500)}`
          );
        }

        serializedResponse = serializeOpenCodeResponse(response);

        if (!serializedResponse) {
          throw new Error('OpenCode returned no structured text response for the requested JSON payload.');
        }

        const parsed = coerceReviewerPayload(JSON.parse(extractJson(serializedResponse)));
        const normalized = repairReviewerPayload(parsed);
        const validated = schema.parse(normalized);

        const durationMs = Date.now() - start;

        // 1st preference: query the opencode DB for exact cumulative token counts for this session.
        //   This is the only way to get the real total — the HTTP response only carries the final
        //   answer, not the rolling accumulation across all agentic tool-call turns.
        // 2nd preference: extract usage from response parts/info (provider-specific, rarely populated).
        // 3rd preference: estimate from prompt character lengths (first-turn only, wildly low).
        //
        // Brief delay: the opencode server may write step-finish parts to the DB asynchronously
        // after returning the HTTP response.  Without this wait the query often finds zero rows.
        if (sessionID) {
          await new Promise(resolve => setTimeout(resolve, 500));
        }
        const dbUsage = sessionID ? querySessionActualUsage(server.dbPath, sessionID) : null;
        const responseUsage = extractActualUsage(response);
        const estimatedOutputTokens = Math.ceil(serializedResponse.length / 4);

        let tokensUsed: TokenUsage;
        if (dbUsage) {
          tokensUsed = { inputTokens: dbUsage.inputTokens, outputTokens: dbUsage.outputTokens, estimated: false };
          const cacheStr = (dbUsage.cacheReadTokens > 0 || dbUsage.cacheWriteTokens > 0)
            ? ` + ${dbUsage.cacheReadTokens.toLocaleString()} cache-read + ${dbUsage.cacheWriteTokens.toLocaleString()} cache-write`
            : '';
          const costStr = dbUsage.cost > 0 ? ` | cost: $${dbUsage.cost.toFixed(4)}` : '';
          logRuntimeDebug(`[opencode]${labelTag} ✓ ${callId} completed in ${(durationMs / 1000).toFixed(1)}s: ${dbUsage.inputTokens.toLocaleString()} in + ${dbUsage.outputTokens.toLocaleString()} out${cacheStr} (actual from DB${costStr}), attempt ${attempt + 1}/${MAX_STRUCTURED_OUTPUT_ATTEMPTS}`);
        } else if (responseUsage) {
          tokensUsed = { inputTokens: responseUsage.inputTokens, outputTokens: responseUsage.outputTokens, estimated: false };
          logRuntimeDebug(`[opencode]${labelTag} ✓ ${callId} completed in ${(durationMs / 1000).toFixed(1)}s: ${responseUsage.inputTokens.toLocaleString()} in + ${responseUsage.outputTokens.toLocaleString()} out (actual from response), attempt ${attempt + 1}/${MAX_STRUCTURED_OUTPUT_ATTEMPTS}`);
        } else {
          tokensUsed = { inputTokens: estimatedInputTokens, outputTokens: estimatedOutputTokens, estimated: true };
          logRuntimeDebug(`[opencode]${labelTag} ✓ ${callId} completed in ${(durationMs / 1000).toFixed(1)}s: ~${estimatedInputTokens} in + ~${estimatedOutputTokens} out (⚠ FIRST-TURN ESTIMATE ONLY — agentic turns not counted), attempt ${attempt + 1}/${MAX_STRUCTURED_OUTPUT_ATTEMPTS}`);
        }

        return {
          data: validated,
          model: options.model,
          runtime: 'cli',
          durationMs,
          rawResponse: serializedResponse,
          tokensUsed,
        };
      } catch (err) {
        lastError = err;
        const durationMs = Date.now() - start;
        const willRetry = shouldRetryStructuredOutput(err, attempt);

        // Track the last raw JSON for AI repair
        if ((err instanceof z.ZodError || err instanceof SyntaxError) && serializedResponse) {
          lastRawJson = serializedResponse;
        }

        logRuntimeDebug(`[opencode] ✗ ${callId} failed after ${(durationMs / 1000).toFixed(1)}s (attempt ${attempt + 1}/${MAX_STRUCTURED_OUTPUT_ATTEMPTS}, retry=${willRetry}): ${summarizeSdkError(err)}`);
        if (err instanceof z.ZodError) {
          logRuntimeDebug(`[opencode]   Validation errors: ${formatValidationFeedback(err)}`);
        }

        if (!willRetry) {
          break; // Fall through to AI repair attempt
        }
      } finally {
        if (sessionID) {
          try {
            await this.request<boolean>(`${server.url}/session/${sessionID}`, {
              method: 'DELETE',
              headers,
            }, 10_000);
          } catch {
            // Best-effort cleanup; stale sessions should not fail the review run.
          }
        }
      }
    }

    // AI structure repair: use a targeted call to fix malformed JSON
    if (lastRawJson) {
      logRuntimeDebug(`[opencode] Attempting AI structure repair for ${callId}...`);
      let repairSessionID: string | undefined;
      try {
        const repair = buildStructureRepairPrompt(lastRawJson, formatZodErrors(lastError));
        const repairSession = await this.request<OpenCodeSession>(`${server.url}/session`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ title: 'CodeOwl Structure Repair' }),
        }, 30_000);
        repairSessionID = repairSession.id;

        const repairResponse = await this.request<OpenCodeMessageResponse>(`${server.url}/session/${repairSessionID}/message`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            model: {
              providerID: target.transport,
              modelID: target.modelId,
            },
            format: {
              type: 'json_schema',
              name: 'CodeOwlRepair',
              schema: responseSchema,
              retryCount: 0,
            },
            system: repair.systemPrompt,
            parts: [{ type: 'text', text: repair.userMessage }],
          }),
        }, 60_000);

        const repairSerialized = serializeOpenCodeResponse(repairResponse);
        if (repairSerialized) {
          const repairParsed = coerceReviewerPayload(JSON.parse(extractJson(repairSerialized)));
          const repairNormalized = repairReviewerPayload(repairParsed);
          const repairResult = tryParseAndValidate(JSON.stringify(repairNormalized), schema);
          if ('data' in repairResult) {
            const durationMs = Date.now() - start;
            const estimatedOutputTokens = Math.ceil(repairSerialized.length / 4);
            logRuntimeDebug(`[opencode] ✓ AI repair succeeded for ${callId} in ${(durationMs / 1000).toFixed(1)}s`);
            return {
              data: repairResult.data,
              model: options.model,
              runtime: 'cli',
              durationMs,
              rawResponse: repairSerialized,
              tokensUsed: {
                inputTokens: Math.ceil((repair.systemPrompt.length + repair.userMessage.length) / 4),
                outputTokens: estimatedOutputTokens,
                estimated: true,
              },
            };
          }
          logRuntimeDebug(`[opencode] ✗ AI repair also failed validation: ${('error' in repairResult ? repairResult.error.message : 'unknown').slice(0, 200)}`);
        }
      } catch (repairErr) {
        logRuntimeDebug(`[opencode] ✗ AI repair call failed: ${(repairErr as Error).message.slice(0, 200)}`);
      } finally {
        if (repairSessionID) {
          try {
            await this.request<boolean>(`${server.url}/session/${repairSessionID}`, {
              method: 'DELETE',
              headers,
            }, 10_000);
          } catch {
            // Best-effort cleanup
          }
        }
      }
    }

    const serverLogs = formatRecentServerLogs(server.logPath);
    throw new Error(
      `OpenCode server request failed for ${callId} via ${server.url}: ${summarizeSdkError(lastError)}${serverLogs ? ` | server logs: ${serverLogs}` : ''}`,
      { cause: lastError },
    );
  }

  async listModels(_provider: string, _apiKey: string, _apiBaseUrl?: string): Promise<string[]> {
    try {
      const server = await getServer({ model: 'openai/gpt-4o-mini', apiKey: _apiKey, apiBaseUrl: _apiBaseUrl });
      const providers = await this.request<{ providers: Array<{ id: string; models?: Record<string, unknown> }> }>(
        `${server.url}/config/providers`,
        {
          method: 'GET',
          headers: {
            'x-opencode-directory': process.cwd(),
          },
        },
        30_000,
      );
      return providers.providers.flatMap(provider => Object.keys(provider.models || {}).map(modelID => `${provider.id}/${modelID}`));
    } catch {
      return [];
    }
  }

  private async request<T>(url: string, init: RequestInit, timeoutMs: number): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        ...init,
        signal: controller.signal,
      });
      const bodyText = await response.text();

      if (!response.ok) {
        throw new Error(`${response.status} ${response.statusText}${bodyText ? `: ${bodyText}` : ''}`);
      }

      return bodyText ? JSON.parse(bodyText) as T : (true as T);
    } catch (err) {
      const method = init.method || 'GET';
      if (
        (err instanceof DOMException && err.name === 'AbortError') ||
        (err instanceof Error && (err.message.includes('aborted') || err.name === 'AbortError'))
      ) {
        const seconds = Math.round(timeoutMs / 1000);
        throw new Error(`Timed out after ${seconds}s during ${method} ${url}`, { cause: err });
      }
      throw new Error(`Request ${method} ${url} failed: ${formatErrorWithCauses(err)}`, { cause: err });
    } finally {
      clearTimeout(timer);
    }
  }
}

function formatRecentServerLogs(logPath: string): string {
  if (!fs.existsSync(logPath)) {
    return '';
  }

  try {
    const lines = fs.readFileSync(logPath, 'utf-8')
      .split(/\r?\n/)
      .map((line: string) => line.trim())
      .filter(Boolean);
    return lines.slice(-5).join(' | ');
  } catch {
    return '';
  }
}
