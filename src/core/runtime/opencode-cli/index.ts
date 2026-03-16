import { spawn } from 'child_process';
import { createServer, AddressInfo } from 'net';
import { z } from 'zod';
import { AgenticRepositoryReviewOptions, IRuntime, RunOptions, RunResult, resolveModelTarget } from '../interface';
import { buildOpenCodeEnvironment, resolveOpenCodeInvocation } from './command';

type OpenCodeServerHandle = {
  url: string;
  child: ReturnType<typeof spawn>;
  envSignature: string;
  close: () => void;
};

type OpenCodeSession = {
  id: string;
};

type OpenCodeMessagePart =
  | { type: 'text'; text: string }
  | { type: string; [key: string]: unknown };

type OpenCodeMessageResponse = {
  info: {
    structured?: unknown;
    error?: {
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
    let sessionID: string | undefined;
    const headers = {
      'content-type': 'application/json',
      'x-opencode-directory': cwd,
    };

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
            schema: {
              type: 'object',
              additionalProperties: true,
            },
          },
          system: options.systemPrompt,
          parts: [{ type: 'text', text: options.userMessage }],
        }),
      }, timeoutMs);

      const providerError = response.info.error?.data?.message;
      if (providerError) {
        throw new Error(providerError);
      }

      const rawText = response.parts
        .filter((part): part is { type: 'text'; text: string } => part.type === 'text' && typeof part.text === 'string')
        .map(part => part.text)
        .join('\n')
        .trim();

      const fallbackStructured = response.info.structured;
      const serializedResponse = rawText || (fallbackStructured !== undefined ? JSON.stringify(fallbackStructured) : '');

      if (!serializedResponse) {
        throw new Error('OpenCode returned no structured text response for the requested JSON payload.');
      }

      const parsed = JSON.parse(extractJson(serializedResponse));
      const validated = schema.parse(parsed);

      return {
        data: validated,
        model: options.model,
        runtime: 'cli',
        durationMs: Date.now() - start,
        rawResponse: serializedResponse,
      };
    } catch (err) {
      throw new Error(`OpenCode server request failed: ${summarizeSdkError(err)}`, { cause: err });
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
    } finally {
      clearTimeout(timer);
    }
  }
}
