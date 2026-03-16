import { spawn } from 'child_process';
import { createServer, AddressInfo } from 'net';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { AgenticRepositoryReviewOptions, IRuntime, RunOptions, RunResult, TokenUsage, resolveModelTarget } from '../interface';
import { buildOpenCodeEnvironment, resolveOpenCodeInvocation } from './command';

type OpenCodeServerHandle = {
  url: string;
  child: ReturnType<typeof spawn>;
  envSignature: string;
  close: () => void;
};

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
  };
  parts: OpenCodeMessagePart[];
};

let activeServerPromise: Promise<OpenCodeServerHandle> | null = null;
let activeServerSignature: string | null = null;
let shutdownHooksRegistered = false;

function extractJson(rawText: string): string {
  const jsonMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)```/) ||
    rawText.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
  return jsonMatch ? jsonMatch[1].trim() : rawText.trim();
}

function summarizeSdkError(err: unknown): string {
  const candidate = err as {
    message?: string;
    data?: unknown;
    error?: unknown;
    cause?: unknown;
  };

  if (candidate?.message) {
    return candidate.message;
  }

  if (candidate?.error) {
    return JSON.stringify(candidate.error);
  }

  if (candidate?.data) {
    return JSON.stringify(candidate.data);
  }

  return String(err);
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
    || asTrimmedString(record.action);
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
  const child = spawn(
    invocation.command,
    [...invocation.args, 'serve', '--hostname=127.0.0.1', `--port=${port}`],
    {
      cwd: process.cwd(),
      env,
      stdio: 'ignore',
      windowsHide: true,
    },
  );

  const url = `http://127.0.0.1:${port}`;

  try {
    await waitForServerReady(url, child, readinessTimeoutMs);
  } catch (err) {
    child.kill();
    throw err;
  }

  child.unref();

  return {
    url,
    child,
    envSignature: buildEnvSignature(env),
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
    return this.executePrompt(options, schema, options.cwd || process.cwd(), 120_000);
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
    const responseSchema = buildStructuredOutputSchema(schema);
    const headers = {
      'content-type': 'application/json',
      'x-opencode-directory': cwd,
    };
    let lastError: unknown;
    // Estimate input tokens from prompt character lengths (1 token ≈ 4 chars)
    const estimatedInputTokens = Math.ceil((options.systemPrompt.length + options.userMessage.length) / 4);

    for (let attempt = 0; attempt < MAX_STRUCTURED_OUTPUT_ATTEMPTS; attempt++) {
      let sessionID: string | undefined;
      const validationRetryNote = attempt === 0
        ? ''
        : `\n\nPREVIOUS ATTEMPT FAILED STRUCTURED OUTPUT VALIDATION. Return ONLY JSON matching the requested schema with all required fields and correct value types. Validation issue: ${formatValidationFeedback(lastError)}`;

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

        const providerError = response.info.error?.data?.message || response.info.error?.message;
        if (providerError) {
          throw new Error(providerError);
        }

        const serializedResponse = serializeOpenCodeResponse(response);

        if (!serializedResponse) {
          throw new Error('OpenCode returned no structured text response for the requested JSON payload.');
        }

        const parsed = coerceReviewerPayload(JSON.parse(extractJson(serializedResponse)));
        const normalized = repairReviewerPayload(parsed);
        const validated = schema.parse(normalized);

        const estimatedOutputTokens = Math.ceil(serializedResponse.length / 4);
        const tokensUsed: TokenUsage = {
          inputTokens: estimatedInputTokens,
          outputTokens: estimatedOutputTokens,
          estimated: true,
        };

        return {
          data: validated,
          model: options.model,
          runtime: 'cli',
          durationMs: Date.now() - start,
          rawResponse: serializedResponse,
          tokensUsed,
        };
      } catch (err) {
        lastError = err;

        if (!shouldRetryStructuredOutput(err, attempt)) {
          throw new Error(`OpenCode server request failed: ${summarizeSdkError(err)}`, { cause: err });
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

    throw new Error(`OpenCode server request failed: ${summarizeSdkError(lastError)}`, { cause: lastError });
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
      if (
        (err instanceof DOMException && err.name === 'AbortError') ||
        (err instanceof Error && (err.message.includes('aborted') || err.name === 'AbortError'))
      ) {
        const seconds = Math.round(timeoutMs / 1000);
        throw new Error(`Timed out after ${seconds}s`);
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }
}
