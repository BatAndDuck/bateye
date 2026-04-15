import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { pathToFileURL } from 'url';
import execa from 'execa';
import { generateText } from 'ai';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { buildProviderOptions, prepareModel } from '../direct/index';
import { logRuntimeDebug } from '../debug';
import { formatErrorWithCauses } from '../error-format';
import { resolveVercelGatewayCredential } from '../provider-routing';
import {
  AgenticRepositoryReviewOptions,
  IRuntime,
  normalizeTransport,
  resolveModelTarget,
  RunOptions,
  RunResult,
  TokenUsage,
} from '../interface';
import {
  buildStructureRepairPrompt,
  extractJsonFromText,
  formatZodErrors,
  tryParseAndValidate,
} from '../structure-repair';
import {
  CodebiteProvider,
  formatSupportedCodebiteProviders,
  normalizeCodebiteProvider,
} from './models';

const DEFAULT_CODEBITE_MAX_STEPS = 30;
const DEFAULT_AGENTIC_TIMEOUT_MS = 1_200_000;
const MAX_CODEBITE_STRUCTURED_OUTPUT_ATTEMPTS = 2;
const zodToJsonSchemaUntyped = zodToJsonSchema as unknown as (
  schema: z.ZodTypeAny,
  name: string,
) => Record<string, unknown>;

export type CodebiteRuntimeConfig = {
  provider: CodebiteProvider;
  model: string;
  apiKey: string;
  baseURL?: string;
  maxSteps: number;
  deepMode: boolean;
  disableSubagents: boolean;
  tools: {
    tavilyApiKey?: string;
    context7ApiKey?: string;
  };
};

export type CodebiteRuntimeInfo = {
  version: string;
  packageJsonPath: string;
};

type CodebiteRuntimeError = Error & {
  codebiteArtifactPaths?: string[];
};

type CodebiteWorkerOutput = {
  text?: string;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
  };
};

type CodebiteWorkerRunResult = {
  workerOutput: CodebiteWorkerOutput;
  rawText: string;
  stdout: string;
  stderr: string;
};

type CodebiteDiagnosisRecord = {
  type?: string;
  timestamp?: string;
  stepNumber?: number;
  durationMs?: number;
  finishReason?: string;
  question?: string;
  executionPrompt?: string;
  systemPrompt?: string;
  repositoryStructure?: string;
  config?: {
    provider?: string;
    model?: string;
    maxSteps?: number;
    deepMode?: boolean;
    disableSubagents?: boolean;
  };
  initialMessages?: Array<{ role?: string; content?: unknown }>;
  inputContext?: {
    startedAt?: string;
    system?: string;
    messages?: Array<{ role?: string; content?: unknown }>;
    activeTools?: string[];
    toolChoice?: unknown;
  };
  text?: string;
  toolCalls?: Array<{ toolName?: string; input?: unknown; args?: unknown }>;
  toolResults?: Array<{ toolCallId?: string; output?: unknown; error?: unknown }>;
  output?: {
    text?: string;
    toolCalls?: Array<{ toolName?: string; input?: unknown }>;
    toolResults?: Array<{ toolCallId?: string; output?: unknown; error?: unknown }>;
    responseMessages?: unknown;
  };
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  };
  totalUsage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  };
  stepCount?: number;
  finalText?: string;
};

type CodebiteFailureArtifactPaths = {
  summaryPath: string;
  tracePath: string;
  stdoutPath?: string;
  stderrPath?: string;
  rawResponsePath?: string;
};

type CodebiteFailureSummary = {
  label?: string;
  provider?: string;
  model?: string;
  error?: {
    message?: string;
    stack?: string;
  };
  worker?: {
    stdoutPreview?: string;
    stderrPreview?: string;
  };
  artifactPaths?: CodebiteFailureArtifactPaths;
};

class CodebiteStructuredOutputError extends Error {
  rawResponse: string;
  extractedJson: string;
  initialError: Error;
  finalError: Error;
  repairResponse?: string;
  repairTokensUsed?: TokenUsage;

  constructor(args: {
    rawResponse: string;
    extractedJson: string;
    initialError: Error;
    finalError: Error;
    repairResponse?: string;
    repairTokensUsed?: TokenUsage;
  }) {
    super(formatErrorWithCauses(args.finalError));
    this.name = 'CodebiteStructuredOutputError';
    this.rawResponse = args.rawResponse;
    this.extractedJson = args.extractedJson;
    this.initialError = args.initialError;
    this.finalError = args.finalError;
    this.repairResponse = args.repairResponse;
    this.repairTokensUsed = args.repairTokensUsed;
  }
}

function resolvePackageModuleUrl(packageName: string): string {
  const packageJsonPath = require.resolve(`${packageName}/package.json`);
  return pathToFileURL(path.join(path.dirname(packageJsonPath), 'dist', 'index.js')).href;
}

export function buildCodebiteWorkerScript(packageJsonPath: string): string {
  const packageRoot = path.dirname(packageJsonPath);
  const agentModuleUrl = pathToFileURL(path.join(packageRoot, 'dist', 'agent.js')).href;
  const openaiModuleUrl = resolvePackageModuleUrl('@ai-sdk/openai');
  const anthropicModuleUrl = resolvePackageModuleUrl('@ai-sdk/anthropic');
  const googleModuleUrl = resolvePackageModuleUrl('@ai-sdk/google');
  const mistralModuleUrl = resolvePackageModuleUrl('@ai-sdk/mistral');
  const azureModuleUrl = resolvePackageModuleUrl('@ai-sdk/azure');
  const cohereModuleUrl = resolvePackageModuleUrl('@ai-sdk/cohere');
  const deepseekModuleUrl = resolvePackageModuleUrl('@ai-sdk/deepseek');
  const fireworksModuleUrl = resolvePackageModuleUrl('@ai-sdk/fireworks');
  const groqModuleUrl = resolvePackageModuleUrl('@ai-sdk/groq');
  const togetheraiModuleUrl = resolvePackageModuleUrl('@ai-sdk/togetherai');
  const xaiModuleUrl = resolvePackageModuleUrl('@ai-sdk/xai');
  const bedrockModuleUrl = resolvePackageModuleUrl('@ai-sdk/amazon-bedrock');
  const aiModuleUrl = pathToFileURL(require.resolve('ai')).href;
  const undiciModuleUrl = pathToFileURL(require.resolve('undici')).href;

  return String.raw`
import { readFile, writeFile } from 'node:fs/promises';
import { runAgent } from ${JSON.stringify(agentModuleUrl)};
import { createGateway } from ${JSON.stringify(aiModuleUrl)};
import { createOpenAI } from ${JSON.stringify(openaiModuleUrl)};
import { createAnthropic } from ${JSON.stringify(anthropicModuleUrl)};
import { createGoogleGenerativeAI } from ${JSON.stringify(googleModuleUrl)};
import { createMistral } from ${JSON.stringify(mistralModuleUrl)};
import { createAzure } from ${JSON.stringify(azureModuleUrl)};
import { createCohere } from ${JSON.stringify(cohereModuleUrl)};
import { createDeepSeek } from ${JSON.stringify(deepseekModuleUrl)};
import { createFireworks } from ${JSON.stringify(fireworksModuleUrl)};
import { createGroq } from ${JSON.stringify(groqModuleUrl)};
import { createTogetherAI } from ${JSON.stringify(togetheraiModuleUrl)};
import { createXai } from ${JSON.stringify(xaiModuleUrl)};
import { createAmazonBedrock } from ${JSON.stringify(bedrockModuleUrl)};
import { Agent } from ${JSON.stringify(undiciModuleUrl)};

const inputPath = process.env.BATEYE_CODEBITE_INPUT;
const outputPath = process.env.BATEYE_CODEBITE_OUTPUT;

if (!inputPath || !outputPath) {
  throw new Error('BATEYE_CODEBITE_INPUT and BATEYE_CODEBITE_OUTPUT are required.');
}

const payload = JSON.parse(await readFile(inputPath, 'utf8'));
const model = resolveModel(payload.config);
const usage = { inputTokens: 0, outputTokens: 0 };
const gatewayRequestTimeoutMs = resolveGatewayRequestTimeoutMs(payload.timeoutMs);
const gatewayDispatcher = new Agent({
  headersTimeout: gatewayRequestTimeoutMs,
  bodyTimeout: gatewayRequestTimeoutMs,
});

function resolveGatewayRequestTimeoutMs(timeoutMs) {
  const minimumMs = 15 * 60 * 1000;
  const bufferMs = 30_000;
  const requestedMs =
    typeof timeoutMs === 'number' && Number.isFinite(timeoutMs) && timeoutMs > 0
      ? timeoutMs + bufferMs
      : 0;

  return Math.max(minimumMs, requestedMs);
}

function resolveModel(config) {
  switch (config.provider) {
    case 'vercel':
      return createGateway({
        apiKey: config.apiKey,
        ...(config.baseURL ? { baseURL: config.baseURL } : {}),
        fetch: (url, init) => fetch(url, {
          ...init,
          dispatcher: gatewayDispatcher,
        }),
      })(config.model);
    case 'openai':
      return createOpenAI({
        apiKey: config.apiKey,
        ...(config.baseURL ? { baseURL: config.baseURL } : {}),
      }).languageModel(config.model);
    case 'anthropic':
      return createAnthropic({
        apiKey: config.apiKey,
        ...(config.baseURL ? { baseURL: config.baseURL } : {}),
      }).languageModel(config.model);
    case 'google':
      return createGoogleGenerativeAI({
        apiKey: config.apiKey,
        ...(config.baseURL ? { baseURL: config.baseURL } : {}),
      }).languageModel(config.model);
    case 'mistral':
      return createMistral({
        apiKey: config.apiKey,
        ...(config.baseURL ? { baseURL: config.baseURL } : {}),
      }).languageModel(config.model);
    case 'azure':
      return createAzure({
        apiKey: config.apiKey,
        ...(config.baseURL ? { baseURL: config.baseURL } : {}),
      }).languageModel(config.model);
    case 'cohere':
      return createCohere({
        apiKey: config.apiKey,
        ...(config.baseURL ? { baseURL: config.baseURL } : {}),
      }).languageModel(config.model);
    case 'deepseek':
      return createDeepSeek({
        apiKey: config.apiKey,
        ...(config.baseURL ? { baseURL: config.baseURL } : {}),
      }).languageModel(config.model);
    case 'fireworks':
      return createFireworks({
        apiKey: config.apiKey,
        ...(config.baseURL ? { baseURL: config.baseURL } : {}),
      }).languageModel(config.model);
    case 'groq':
      return createGroq({
        apiKey: config.apiKey,
        ...(config.baseURL ? { baseURL: config.baseURL } : {}),
      }).languageModel(config.model);
    case 'togetherai':
      return createTogetherAI({
        apiKey: config.apiKey,
        ...(config.baseURL ? { baseURL: config.baseURL } : {}),
      }).languageModel(config.model);
    case 'xai':
      return createXai({
        apiKey: config.apiKey,
        ...(config.baseURL ? { baseURL: config.baseURL } : {}),
      }).languageModel(config.model);
    case 'bedrock':
      return createAmazonBedrock({
        apiKey: config.apiKey,
        ...(config.baseURL ? { baseURL: config.baseURL } : {}),
      }).languageModel(config.model);
    case 'litellm':
      return createOpenAI({
        apiKey: config.apiKey,
        baseURL: config.baseURL || 'http://localhost:4000',
      }).languageModel(config.model);
    default:
      throw new Error(
        'Unknown provider "' + config.provider + '". Supported providers: '
        + 'openai, anthropic, google, mistral, vercel, groq, xai, cohere, deepseek, bedrock, azure, togetherai, fireworks, litellm'
      );
  }
}

const text = await runAgent({
  model,
  question: payload.question,
  config: payload.config,
  ...(payload.diagnosticsPath ? { diagnosticsPath: payload.diagnosticsPath } : {}),
  onStep: (step) => {
    usage.inputTokens += Number(step.usage?.inputTokens ?? 0);
    usage.outputTokens += Number(step.usage?.outputTokens ?? 0);
  },
});

await writeFile(outputPath, JSON.stringify({ text, usage }, null, 2), 'utf8');
`;
}

export function extractCodebiteArtifactPaths(error: unknown): string[] {
  const seen = new Set<unknown>();
  const paths: string[] = [];

  function visit(value: unknown): void {
    if (!value || seen.has(value) || typeof value !== 'object') {
      return;
    }
    seen.add(value);

    const candidate = value as { codebiteArtifactPaths?: unknown; cause?: unknown; errors?: unknown[] };
    if (Array.isArray(candidate.codebiteArtifactPaths)) {
      for (const pathItem of candidate.codebiteArtifactPaths) {
        if (typeof pathItem === 'string' && pathItem.trim() && !paths.includes(pathItem.trim())) {
          paths.push(pathItem.trim());
        }
      }
    }

    if (Array.isArray(candidate.errors)) {
      for (const nested of candidate.errors) {
        visit(nested);
      }
    }

    visit(candidate.cause);
  }

  visit(error);
  return paths;
}

export function extractCodebiteFailureDetail(error: unknown): string | undefined {
  for (const artifactPath of extractCodebiteArtifactPaths(error)) {
    if (!artifactPath.endsWith('.codebite.failure.summary.json')) {
      continue;
    }

    try {
      const summary = JSON.parse(fs.readFileSync(artifactPath, 'utf-8')) as CodebiteFailureSummary;
      const detail = summary.worker?.stderrPreview?.trim()
        || summary.worker?.stdoutPreview?.trim()
        || summary.error?.message?.trim();
      if (detail) {
        return detail;
      }
    } catch {
      // Best-effort only. Fall back to generic error formatting.
    }
  }

  return undefined;
}

export function resolveCodebiteRuntimeInfo(): CodebiteRuntimeInfo | null {
  try {
    const packageJsonPath = require.resolve('codebite/package.json');
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8')) as { version?: string };
    const distCliPath = path.resolve(path.dirname(packageJsonPath), 'dist', 'cli.js');
    if (!fs.existsSync(distCliPath)) {
      return null;
    }

    return {
      version: packageJson.version || 'unknown',
      packageJsonPath,
    };
  } catch {
    return null;
  }
}

export function assertCodebiteAgenticSupport(
  options: Pick<RunOptions, 'model' | 'transport' | 'apiBaseUrl'>,
): CodebiteRuntimeConfig {
  const target = resolveModelTarget(options.model, options.transport);
  const normalizedTransport = normalizeTransport(target.transport);
  const provider = normalizeCodebiteProvider(normalizedTransport);

  if (!provider) {
    throw new Error(
      `Agentic review does not support transport "${normalizedTransport}". `
      + `Supported providers: ${formatSupportedCodebiteProviders()}.`
    );
  }

  const baseURL = options.apiBaseUrl?.trim() || undefined;
  if ((provider === 'azure' || provider === 'litellm') && !baseURL) {
    throw new Error(
      `Agentic review with transport "${provider}" requires apiBaseUrl. `
      + 'Set it in .bateye/config.json or via `bateye config set apiBaseUrl <url>`.'
    );
  }

  return {
    provider,
    model: target.modelId,
    apiKey: '',
    ...(baseURL ? { baseURL } : {}),
    maxSteps: DEFAULT_CODEBITE_MAX_STEPS,
    deepMode: false,
    disableSubagents: false,
    tools: {},
  };
}

export function validateCodebiteAgenticModels(
  entries: Array<Pick<RunOptions, 'model' | 'transport' | 'apiBaseUrl'>>,
): void {
  for (const entry of entries) {
    assertCodebiteAgenticSupport(entry);
  }
}

export class CodebiteAgentRuntime implements IRuntime {
  async run<T>(_options: RunOptions, _schema: z.ZodType<T, z.ZodTypeDef, unknown>): Promise<RunResult<T>> {
    throw new Error('CodebiteAgentRuntime does not implement structured run(); use DirectAIRuntime instead.');
  }

  async runAgenticReview<T>(
    options: AgenticRepositoryReviewOptions,
    schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  ): Promise<RunResult<T>> {
    const start = Date.now();
    const runtimeInfo = resolveCodebiteRuntimeInfo();
    if (!runtimeInfo) {
      throw new Error('Codebite runtime is not available. Install dependencies and ensure codebite/dist/cli.js exists.');
    }

    const runtimeConfig = buildCodebiteRuntimeConfig(options);
    const workerScript = buildCodebiteWorkerScript(runtimeInfo.packageJsonPath);
    const schemaJson = zodToJsonSchemaUntyped(schema as z.ZodTypeAny, 'BatEyeResponse');
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bateye-codebite-'));
    const inputPath = path.join(tempDir, 'request.json');
    const outputPath = path.join(tempDir, 'response.json');
    const labelTag = options.callLabel ? ` [${options.callLabel}]` : '';
    const timeoutMs = options.timeoutMs ?? DEFAULT_AGENTIC_TIMEOUT_MS;
    let lastQuestion = buildCodebiteQuestion(options, schemaJson);
    let lastDiagnosticsPath = resolveCodebiteDiagnosticsPath(options, 1);
    let lastTracePath = resolveCodebiteTracePath(lastDiagnosticsPath);
    let lastAttempt = 1;

    logRuntimeDebug(
      `[codebite]${labelTag} Starting review: provider=${runtimeConfig.provider}, model=${runtimeConfig.model}, `
      + `maxSteps=${runtimeConfig.maxSteps}, deepMode=${runtimeConfig.deepMode}, `
      + `disableSubagents=${runtimeConfig.disableSubagents}, timeout=${Math.round(timeoutMs / 1000)}s`,
    );

    try {
      let aggregatedTokensUsed: TokenUsage | undefined;
      let parsedResult:
        | { data: T; rawResponse: string; repairTokensUsed?: TokenUsage }
        | undefined;
      let successfulAttempt:
        | { workerRun: CodebiteWorkerRunResult; question: string; diagnosticsPath?: string; tracePath?: string }
        | undefined;
      let lastStructuredOutputError: unknown;

      for (let attempt = 1; attempt <= MAX_CODEBITE_STRUCTURED_OUTPUT_ATTEMPTS; attempt++) {
        const question = buildCodebiteQuestion(
          options,
          schemaJson,
          attempt > 1
            ? buildCodebiteRetryNotice(lastStructuredOutputError)
            : undefined,
        );
        const diagnosticsPath = resolveCodebiteDiagnosticsPath(options, attempt);
        const tracePath = resolveCodebiteTracePath(diagnosticsPath);
        lastAttempt = attempt;
        lastQuestion = question;
        lastDiagnosticsPath = diagnosticsPath;
        lastTracePath = tracePath;
        const workerRun = await runCodebiteWorker({
          workerScript,
          repoPath: options.repoPath,
          inputPath,
          outputPath,
          payload: {
            config: runtimeConfig,
            question,
            timeoutMs,
            diagnosticsPath,
          },
          timeoutMs,
        });

        try {
          const parsed = await parseAndRepairCodebiteOutput(workerRun.rawText, options, schema, labelTag);
          aggregatedTokensUsed = addCodebiteTokens(
            aggregatedTokensUsed,
            mergeCodebiteTokens(
              workerRun.workerOutput.usage,
              question,
              parsed.rawResponse,
              parsed.repairTokensUsed,
            ),
          );
          parsedResult = parsed;
          successfulAttempt = {
            workerRun,
            question,
            diagnosticsPath,
            tracePath,
          };
          break;
        } catch (err) {
          aggregatedTokensUsed = addCodebiteTokens(
            aggregatedTokensUsed,
            mergeCodebiteTokens(
              workerRun.workerOutput.usage,
              question,
              workerRun.rawText,
              err instanceof CodebiteStructuredOutputError ? err.repairTokensUsed : undefined,
            ),
          );

          if (err instanceof CodebiteStructuredOutputError) {
            writeCodebiteParseFailureArtifacts({
              options,
              attempt,
              provider: runtimeConfig.provider,
              model: runtimeConfig.model,
              question,
              workerStdout: workerRun.stdout,
              workerStderr: workerRun.stderr,
              rawResponse: workerRun.rawText,
              extractedJson: err.extractedJson,
              repairResponse: err.repairResponse,
              initialError: err.initialError,
              finalError: err.finalError,
            });
          }

          if (attempt < MAX_CODEBITE_STRUCTURED_OUTPUT_ATTEMPTS && shouldRetryStructuredOutputAttempt(err)) {
            lastStructuredOutputError = err;
            logRuntimeDebug(
              `[codebite]${labelTag} First structured output pass was not parseable, retrying Codebite once before surfacing a reviewer failure: ${formatErrorWithCauses(err)}`,
            );
            continue;
          }

          throw err;
        }
      }

      if (!parsedResult || !successfulAttempt) {
        throw new Error('Codebite did not produce a successful structured result.');
      }

      const durationMs = Date.now() - start;
      const tokensUsed = aggregatedTokensUsed;

      if (tokensUsed) {
        const tokenSummary = tokensUsed.estimated
          ? `~${tokensUsed.inputTokens} in + ~${tokensUsed.outputTokens} out (estimated)`
          : `${tokensUsed.inputTokens} in + ${tokensUsed.outputTokens} out`;
        logRuntimeDebug(
          `[codebite]${labelTag} ✓ ${runtimeConfig.provider}/${runtimeConfig.model} completed in ${(durationMs / 1000).toFixed(1)}s: ${tokenSummary}`,
        );
      }

      writeCodebiteDiagnosticTrace({
        diagnosticsPath: successfulAttempt.diagnosticsPath,
        tracePath: successfulAttempt.tracePath,
        provider: runtimeConfig.provider,
        model: runtimeConfig.model,
        labelTag,
        question: successfulAttempt.question,
        workerStdout: successfulAttempt.workerRun.stdout,
        workerStderr: successfulAttempt.workerRun.stderr,
        responseText: successfulAttempt.workerRun.workerOutput.text,
        finalRawResponse: parsedResult.rawResponse,
      });

      return {
        data: parsedResult.data,
        model: options.model,
        runtime: 'cli',
        durationMs,
        rawResponse: parsedResult.rawResponse,
        tokensUsed,
      };
    } catch (err) {
      const diagnosticsPath = lastDiagnosticsPath;
      const tracePath = lastTracePath;
      const failureArtifacts = writeCodebiteFailureArtifacts({
        options,
        runtimeInfo,
        runtimeConfig,
        attempt: lastAttempt,
        question: lastQuestion,
        diagnosticsPath,
        workerScript,
        error: err,
      });
      writeCodebiteDiagnosticTrace({
        diagnosticsPath,
        tracePath: tracePath || failureArtifacts.tracePath,
        provider: runtimeConfig.provider,
        model: runtimeConfig.model,
        labelTag,
        question: lastQuestion,
        error: formatErrorWithCauses(err),
      });
      const message =
        `Codebite agentic review failed for ${runtimeConfig.provider}/${runtimeConfig.model}: ${formatErrorWithCauses(err)}`;
      const wrappedError = new Error(message, { cause: err }) as CodebiteRuntimeError;
      wrappedError.codebiteArtifactPaths = Object.values(failureArtifacts).filter((value): value is string => typeof value === 'string');
      throw wrappedError;
    } finally {
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch {
        // Best-effort cleanup.
      }
    }
  }

  async listModels(_provider: string, _apiKey: string, _apiBaseUrl?: string): Promise<string[]> {
    return [];
  }

  async isAvailable(): Promise<boolean> {
    return resolveCodebiteRuntimeInfo() !== null;
  }
}

function buildCodebiteRuntimeConfig(options: AgenticRepositoryReviewOptions): CodebiteRuntimeConfig {
  const supported = assertCodebiteAgenticSupport(options);
  const resolvedApiKey = resolveCodebiteApiKey(options, supported);

  return {
    ...supported,
    apiKey: resolvedApiKey,
    maxSteps: options.maxSteps ?? supported.maxSteps,
    deepMode: options.deepMode ?? supported.deepMode,
    disableSubagents: options.disableSubagents ?? supported.disableSubagents,
    tools: buildCodebiteToolConfig(),
  };
}

function resolveCodebiteApiKey(
  options: Pick<AgenticRepositoryReviewOptions, 'apiKey' | 'repoPath' | 'cwd'>,
  supported: Pick<CodebiteRuntimeConfig, 'provider'>,
): string {
  if (supported.provider === 'vercel') {
    const credential = resolveVercelGatewayCredential(options.apiKey, options.cwd || options.repoPath);
    if (!credential) {
      throw new Error(
        'Vercel AI Gateway requires a credential. Set BATEYE_LLM_MODEL_API_KEY, AI_GATEWAY_API_KEY, or VERCEL_OIDC_TOKEN.'
      );
    }
    return credential;
  }

  return options.apiKey;
}

function buildCodebiteToolConfig(): CodebiteRuntimeConfig['tools'] {
  const tools: CodebiteRuntimeConfig['tools'] = {};

  if (process.env.TAVILY_API_KEY?.trim()) {
    tools.tavilyApiKey = process.env.TAVILY_API_KEY.trim();
  }

  if (process.env.CONTEXT7_API_KEY?.trim()) {
    tools.context7ApiKey = process.env.CONTEXT7_API_KEY.trim();
  }

  return tools;
}

function buildCodebiteQuestion(
  options: AgenticRepositoryReviewOptions,
  schemaJson: Record<string, unknown>,
  retryNotice?: string,
): string {
  const seedFiles = options.initialFiles?.length
    ? options.initialFiles.map(file => `- ${file}`).join('\n')
    : '- (none specified)';

  return [
    'You are running inside BatEye as an autonomous repository reviewer.',
    'Investigate the current repository state using the available tools before finalizing your response.',
    'Ground your response in the checked-out repository state rather than assumptions.',
    'If a suspected claim is unsupported, uncertain, or only present in removed code, omit it.',
    '',
    '## BatEye System Instructions',
    options.systemPrompt,
    '',
    '## BatEye Review Task',
    options.userMessage,
    '',
    ...(retryNotice
      ? [
          '## Retry Notice',
          retryNotice,
          '',
        ]
      : []),
    '## Suggested Starting Files',
    seedFiles,
    '',
    '## Response Contract',
    'Return ONLY valid JSON that matches this schema. Do not wrap it in markdown fences or add commentary.',
    JSON.stringify(schemaJson, null, 2),
  ].join('\n');
}

function buildCodebiteRetryNotice(lastError: unknown): string {
  const errorSummary = formatErrorWithCauses(lastError);
  return [
    'Your previous response could not be parsed as valid JSON.',
    `Previous parse failure: ${errorSummary}`,
    'Retry now and return ONLY strict JSON that matches the schema.',
    'Double-escape literal backslashes inside JSON strings.',
    'Do not include markdown fences, prose, or commentary.',
  ].join(' ');
}

function resolveCodebiteSafeLabel(options: Pick<AgenticRepositoryReviewOptions, 'callLabel'>): string {
  return (options.callLabel || 'agentic-review')
    .replace(/[^a-z0-9._-]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'agentic-review';
}

function resolveCodebiteDiagnosticsDir(options: Pick<AgenticRepositoryReviewOptions, 'repoPath'>, force: boolean = false): string | undefined {
  if (!force && process.env.BATEYE_DIAGNOSTIC !== '1') {
    return undefined;
  }

  return process.env.BATEYE_DIAGNOSTIC_DIR?.trim()
    ? process.env.BATEYE_DIAGNOSTIC_DIR.trim()
    : path.join(options.repoPath, '.bateye', 'out', 'diagnostics');
}

function resolveCodebiteDiagnosticsPath(
  options: AgenticRepositoryReviewOptions,
  attempt: number = 1,
): string | undefined {
  const diagnosticDir = resolveCodebiteDiagnosticsDir(options);
  if (!diagnosticDir) {
    return undefined;
  }

  const safeLabel = resolveCodebiteSafeLabel(options);
  const fileName = attempt > 1
    ? `${safeLabel}.attempt-${attempt}.codebite.jsonl`
    : `${safeLabel}.codebite.jsonl`;
  return path.join(diagnosticDir, fileName);
}

function resolveCodebiteParseFailureArtifactPaths(
  options: AgenticRepositoryReviewOptions,
  attempt: number,
): { rawPath: string; tracePath: string } {
  const diagnosticDir = resolveCodebiteDiagnosticsDir(options, true) as string;
  const safeLabel = resolveCodebiteSafeLabel(options);
  const suffix = attempt > 1 ? `.attempt-${attempt}` : '';
  return {
    rawPath: path.join(diagnosticDir, `${safeLabel}${suffix}.codebite.parse-failure.raw.txt`),
    tracePath: path.join(diagnosticDir, `${safeLabel}${suffix}.codebite.parse-failure.trace.md`),
  };
}

function resolveCodebiteTracePath(contextDiagnosisPath: string | undefined): string | undefined {
  if (!contextDiagnosisPath) {
    return undefined;
  }

  return contextDiagnosisPath.replace(/\.jsonl$/i, '.trace.md');
}

function resolveCodebiteFailureArtifactPaths(
  options: AgenticRepositoryReviewOptions,
  attempt: number,
): CodebiteFailureArtifactPaths {
  const diagnosticDir = resolveCodebiteDiagnosticsDir(options, true) as string;
  const safeLabel = resolveCodebiteSafeLabel(options);
  const suffix = attempt > 1 ? `.attempt-${attempt}` : '';

  return {
    summaryPath: path.join(diagnosticDir, `${safeLabel}${suffix}.codebite.failure.summary.json`),
    tracePath: path.join(diagnosticDir, `${safeLabel}${suffix}.codebite.failure.trace.md`),
    stdoutPath: path.join(diagnosticDir, `${safeLabel}${suffix}.codebite.failure.stdout.txt`),
    stderrPath: path.join(diagnosticDir, `${safeLabel}${suffix}.codebite.failure.stderr.txt`),
  };
}

async function runCodebiteWorker(args: {
  workerScript: string;
  repoPath: string;
  inputPath: string;
  outputPath: string;
  payload: {
    config: CodebiteRuntimeConfig;
    question: string;
    timeoutMs: number;
    diagnosticsPath?: string;
  };
  timeoutMs: number;
}): Promise<CodebiteWorkerRunResult> {
  fs.writeFileSync(args.inputPath, JSON.stringify(args.payload, null, 2), 'utf-8');

  let workerRun: { stdout: string; stderr: string };
  try {
    const execaResult = await execa(process.execPath, ['--input-type=module', '--eval', args.workerScript], {
      cwd: args.repoPath,
      encoding: 'utf8',
      timeout: args.timeoutMs,
      reject: true,
      env: {
        ...process.env,
        BATEYE_CODEBITE_INPUT: args.inputPath,
        BATEYE_CODEBITE_OUTPUT: args.outputPath,
      },
    });
    workerRun = {
      stdout: String(execaResult.stdout ?? ''),
      stderr: String(execaResult.stderr ?? ''),
    };
  } catch (err) {
    throw normalizeCodebiteWorkerError(err, args.payload.config.provider);
  }

  if (!fs.existsSync(args.outputPath)) {
    throw new Error('Codebite worker exited without writing a response payload.');
  }

  let workerOutput: CodebiteWorkerOutput;
  try {
    workerOutput = JSON.parse(fs.readFileSync(args.outputPath, 'utf-8')) as CodebiteWorkerOutput;
  } catch (err) {
    throw new Error(`Codebite worker wrote malformed response JSON: ${formatErrorWithCauses(err)}`, { cause: err });
  }
  const rawText = typeof workerOutput.text === 'string' ? workerOutput.text.trim() : '';
  if (!rawText) {
    throw new Error('Codebite returned an empty response.');
  }

  return {
    workerOutput,
    rawText,
    stdout: workerRun.stdout,
    stderr: workerRun.stderr,
  };
}

function normalizeCodebiteWorkerError(error: unknown, provider: CodebiteProvider): Error {
  const message = formatErrorWithCauses(error);
  if (provider === 'vercel' && /Error verifying OIDC token/i.test(message)) {
    return new Error(
      'Vercel AI Gateway rejected the configured bearer token for inference. '
      + 'Use an AI Gateway API key created in Vercel AI Gateway, or provide VERCEL_OIDC_TOKEN. '
      + `Original error: ${message}`
    );
  }

  const candidate = error as {
    stdout?: string;
    stderr?: string;
    exitCode?: number;
  } | null;
  const stderr = summarizeCodebiteWorkerStream(candidate?.stderr);
  const stdout = summarizeCodebiteWorkerStream(candidate?.stdout);
  const details = [
    typeof candidate?.exitCode === 'number' ? `exitCode=${candidate.exitCode}` : null,
    stderr ? `stderr: ${stderr}` : null,
    stdout ? `stdout: ${stdout}` : null,
  ].filter(Boolean);

  if (details.length > 0) {
    return new Error(
      `Codebite worker process failed before producing a response (${details.join('; ')})`,
      { cause: error instanceof Error ? error : undefined },
    );
  }

  return error instanceof Error ? error : new Error(message);
}

function summarizeCodebiteWorkerStream(value: string | undefined): string {
  const normalized = value?.trim();
  if (!normalized) {
    return '';
  }

  const compact = normalized.replace(/\s+/g, ' ');
  return compact.length > 400 ? `${compact.slice(0, 397)}...` : compact;
}

function writeCodebiteFailureArtifacts(args: {
  options: AgenticRepositoryReviewOptions;
  runtimeInfo: CodebiteRuntimeInfo;
  runtimeConfig: CodebiteRuntimeConfig;
  attempt: number;
  question: string;
  diagnosticsPath?: string;
  workerScript: string;
  error: unknown;
}): CodebiteFailureArtifactPaths {
  const paths = resolveCodebiteFailureArtifactPaths(args.options, args.attempt);
  try {
    fs.mkdirSync(path.dirname(paths.summaryPath), { recursive: true });

    const candidate = args.error as { stdout?: string; stderr?: string; stack?: string } | null;
    const stdout = typeof candidate?.stdout === 'string' ? candidate.stdout.trim() : '';
    const stderr = typeof candidate?.stderr === 'string' ? candidate.stderr.trim() : '';

    if (stdout) {
      fs.writeFileSync(paths.stdoutPath as string, stdout, 'utf-8');
    } else {
      delete paths.stdoutPath;
    }

    if (stderr) {
      fs.writeFileSync(paths.stderrPath as string, stderr, 'utf-8');
    } else {
      delete paths.stderrPath;
    }

    const summary = {
      label: args.options.callLabel || 'agentic-review',
      provider: args.runtimeConfig.provider,
      model: args.runtimeConfig.model,
      baseURL: args.runtimeConfig.baseURL,
      maxSteps: args.runtimeConfig.maxSteps,
      deepMode: args.runtimeConfig.deepMode,
      disableSubagents: args.runtimeConfig.disableSubagents,
      attempt: args.attempt,
      timeoutMs: args.options.timeoutMs ?? DEFAULT_AGENTIC_TIMEOUT_MS,
      runtimeInfo: {
        version: args.runtimeInfo.version,
        packageJsonPath: args.runtimeInfo.packageJsonPath,
      },
      environment: {
        nodeVersion: process.version,
        execPath: process.execPath,
        platform: process.platform,
        arch: process.arch,
        cwd: args.options.repoPath,
        diagnosticsPath: args.diagnosticsPath,
        diagnosticModeEnabled: process.env.BATEYE_DIAGNOSTIC === '1',
      },
      questionPreview: summarizeCodebiteWorkerStream(args.question),
      initialFiles: args.options.initialFiles?.slice(0, 25) || [],
      initialFileCount: args.options.initialFiles?.length || 0,
      workerScriptPreview: summarizeCodebiteWorkerStream(args.workerScript),
      error: {
        message: formatErrorWithCauses(args.error),
        stack: typeof candidate?.stack === 'string' ? candidate.stack : undefined,
      },
      worker: {
        stdoutPreview: stdout ? summarizeCodebiteWorkerStream(stdout) : undefined,
        stderrPreview: stderr ? summarizeCodebiteWorkerStream(stderr) : undefined,
      },
      artifactPaths: paths,
    };

    fs.writeFileSync(paths.summaryPath, JSON.stringify(summary, null, 2), 'utf-8');
    fs.writeFileSync(paths.tracePath, renderCodebiteFailureTrace({
      attempt: args.attempt,
      provider: args.runtimeConfig.provider,
      model: args.runtimeConfig.model,
      question: args.question,
      diagnosticsPath: args.diagnosticsPath,
      error: args.error,
      workerStdout: stdout,
      workerStderr: stderr,
      summaryPath: paths.summaryPath,
      runtimeInfo: args.runtimeInfo,
      runtimeConfig: args.runtimeConfig,
    }), 'utf-8');
  } catch (artifactErr) {
    const labelTag = args.options.callLabel ? ` [${args.options.callLabel}]` : '';
    logRuntimeDebug(
      `[codebite]${labelTag} Failed to write runtime failure artifacts: ${formatErrorWithCauses(artifactErr)}`,
    );
  }

  return paths;
}

function renderCodebiteFailureTrace(args: {
  attempt: number;
  provider: string;
  model: string;
  question: string;
  diagnosticsPath?: string;
  error: unknown;
  workerStdout?: string;
  workerStderr?: string;
  summaryPath: string;
  runtimeInfo: CodebiteRuntimeInfo;
  runtimeConfig: CodebiteRuntimeConfig;
}): string {
  const lines: string[] = [];

  lines.push('# Codebite Runtime Failure');
  lines.push('');
  lines.push(`- Attempt: ${args.attempt}`);
  lines.push(`- Provider: ${args.provider}`);
  lines.push(`- Model: ${args.model}`);
  lines.push(`- Codebite version: ${args.runtimeInfo.version}`);
  lines.push(`- Package: ${args.runtimeInfo.packageJsonPath}`);
  if (args.runtimeConfig.baseURL) {
    lines.push(`- Base URL: ${args.runtimeConfig.baseURL}`);
  }
  lines.push(`- Max steps: ${args.runtimeConfig.maxSteps}`);
  lines.push(`- Deep mode: ${args.runtimeConfig.deepMode ? 'true' : 'false'}`);
  lines.push(`- Disable subagents: ${args.runtimeConfig.disableSubagents ? 'true' : 'false'}`);
  if (args.diagnosticsPath) {
    lines.push(`- Diagnostics JSONL: ${args.diagnosticsPath}`);
  }
  lines.push(`- Summary JSON: ${args.summaryPath}`);
  lines.push('');

  lines.push('## Error');
  lines.push('');
  lines.push('```text');
  lines.push(formatErrorWithCauses(args.error));
  lines.push('```');
  lines.push('');

  lines.push('## Question');
  lines.push('');
  lines.push('```text');
  lines.push(args.question);
  lines.push('```');
  lines.push('');

  if (args.workerStdout) {
    lines.push('## Worker Stdout');
    lines.push('');
    lines.push('```text');
    lines.push(args.workerStdout);
    lines.push('```');
    lines.push('');
  }

  if (args.workerStderr) {
    lines.push('## Worker Stderr');
    lines.push('');
    lines.push('```text');
    lines.push(args.workerStderr);
    lines.push('```');
    lines.push('');
  }

  return lines.join('\n');
}

function shouldRetryStructuredOutputAttempt(error: unknown): boolean {
  if (!(error instanceof CodebiteStructuredOutputError)) {
    return false;
  }

  return error.initialError instanceof SyntaxError || error.finalError instanceof SyntaxError;
}

function writeCodebiteParseFailureArtifacts(args: {
  options: AgenticRepositoryReviewOptions;
  attempt: number;
  provider: string;
  model: string;
  question: string;
  workerStdout?: string;
  workerStderr?: string;
  rawResponse: string;
  extractedJson: string;
  repairResponse?: string;
  initialError: Error;
  finalError: Error;
}): void {
  try {
    const paths = resolveCodebiteParseFailureArtifactPaths(args.options, args.attempt);
    fs.mkdirSync(path.dirname(paths.rawPath), { recursive: true });
    fs.writeFileSync(paths.rawPath, args.rawResponse, 'utf-8');
    fs.writeFileSync(paths.tracePath, renderCodebiteParseFailureTrace(args), 'utf-8');
  } catch (err) {
    const labelTag = args.options.callLabel ? ` [${args.options.callLabel}]` : '';
    logRuntimeDebug(
      `[codebite]${labelTag} Failed to write parse-failure artifacts: ${formatErrorWithCauses(err)}`,
    );
  }
}

function renderCodebiteParseFailureTrace(args: {
  attempt: number;
  provider: string;
  model: string;
  question: string;
  workerStdout?: string;
  workerStderr?: string;
  rawResponse: string;
  extractedJson: string;
  repairResponse?: string;
  initialError: Error;
  finalError: Error;
}): string {
  const lines: string[] = [];

  lines.push('# Codebite Parse Failure');
  lines.push('');
  lines.push(`- Attempt: ${args.attempt}`);
  lines.push(`- Provider: ${args.provider}`);
  lines.push(`- Model: ${args.model}`);
  lines.push(`- Initial error: ${formatErrorWithCauses(args.initialError)}`);
  lines.push(`- Final error: ${formatErrorWithCauses(args.finalError)}`);
  lines.push('');

  lines.push('## Question');
  lines.push('');
  lines.push('```text');
  lines.push(args.question);
  lines.push('```');
  lines.push('');

  lines.push('## Raw Codebite Response');
  lines.push('');
  lines.push('```text');
  lines.push(args.rawResponse);
  lines.push('```');
  lines.push('');

  lines.push('## Extracted JSON');
  lines.push('');
  lines.push('```text');
  lines.push(args.extractedJson);
  lines.push('```');
  lines.push('');

  if (args.repairResponse) {
    lines.push('## Repair Response');
    lines.push('');
    lines.push('```text');
    lines.push(args.repairResponse);
    lines.push('```');
    lines.push('');
  }

  if (args.workerStdout) {
    lines.push('## Worker Stdout');
    lines.push('');
    lines.push('```text');
    lines.push(args.workerStdout);
    lines.push('```');
    lines.push('');
  }

  if (args.workerStderr) {
    lines.push('## Worker Stderr');
    lines.push('');
    lines.push('```text');
    lines.push(args.workerStderr);
    lines.push('```');
    lines.push('');
  }

  return lines.join('\n');
}

function writeCodebiteDiagnosticTrace(args: {
  diagnosticsPath?: string;
  tracePath?: string;
  provider: string;
  model: string;
  labelTag: string;
  question: string;
  workerStdout?: string;
  workerStderr?: string;
  responseText?: string;
  finalRawResponse?: string;
  error?: string;
}): void {
  if (!args.tracePath) {
    return;
  }

  try {
    const records = readCodebiteDiagnosisRecords(args.diagnosticsPath);
    const trace = renderCodebiteDiagnosticTrace(records, args);
    fs.mkdirSync(path.dirname(args.tracePath), { recursive: true });
    fs.writeFileSync(args.tracePath, trace, 'utf-8');
    logRuntimeDebug(`[codebite]${args.labelTag} Diagnostic trace written to ${args.tracePath}`);
  } catch (err) {
    logRuntimeDebug(
      `[codebite]${args.labelTag} Failed to write diagnostic trace: ${formatErrorWithCauses(err)}`,
    );
  }
}

function readCodebiteDiagnosisRecords(diagnosticsPath: string | undefined): CodebiteDiagnosisRecord[] {
  if (!diagnosticsPath || !fs.existsSync(diagnosticsPath)) {
    return [];
  }

  return fs
    .readFileSync(diagnosticsPath, 'utf-8')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => JSON.parse(line) as CodebiteDiagnosisRecord);
}

function getStepOutputText(record: CodebiteDiagnosisRecord | undefined): string | undefined {
  return record?.output?.text ?? record?.text;
}

function getStepToolCalls(record: CodebiteDiagnosisRecord | undefined): Array<{ toolName?: string; input?: unknown; args?: unknown }> {
  return record?.output?.toolCalls ?? record?.toolCalls ?? [];
}

function getStepToolResults(record: CodebiteDiagnosisRecord | undefined): Array<{ toolCallId?: string; output?: unknown; error?: unknown }> {
  return record?.output?.toolResults ?? record?.toolResults ?? [];
}

function getStepInputContext(record: CodebiteDiagnosisRecord | undefined): CodebiteDiagnosisRecord['inputContext'] | undefined {
  return record?.inputContext;
}

function renderCodebiteDiagnosticTrace(
  records: CodebiteDiagnosisRecord[],
  args: {
    provider: string;
    model: string;
    question: string;
    workerStdout?: string;
    workerStderr?: string;
    responseText?: string;
    finalRawResponse?: string;
    error?: string;
  },
): string {
  const lines: string[] = [];
  const runStart = records.find(record => record.type === 'run-start');
  const runFinish = [...records].reverse().find(record => record.type === 'run-finish');
  const legacySteps = records.filter(record => record.type === 'step');
  const stepStarts = new Map<number, CodebiteDiagnosisRecord>();
  const stepFinishes = new Map<number, CodebiteDiagnosisRecord>();

  for (const record of records) {
    if (typeof record.stepNumber !== 'number') {
      continue;
    }

    if (record.type === 'step-start') {
      stepStarts.set(record.stepNumber, record);
    } else if (record.type === 'step-finish') {
      stepFinishes.set(record.stepNumber, record);
    }
  }

  const numberedSteps = Array.from(new Set([
    ...stepStarts.keys(),
    ...stepFinishes.keys(),
    ...legacySteps
      .map(record => record.stepNumber)
      .filter((stepNumber): stepNumber is number => typeof stepNumber === 'number'),
  ])).sort((a, b) => a - b);

  lines.push('# Codebite Diagnostic Trace');
  lines.push('');
  lines.push(`- Provider: ${args.provider}`);
  lines.push(`- Model: ${args.model}`);
  if (runStart?.timestamp) {
    lines.push(`- Started: ${runStart.timestamp}`);
  }
  if (runFinish?.timestamp) {
    lines.push(`- Finished: ${runFinish.timestamp}`);
  }
  if (typeof runFinish?.stepCount === 'number') {
    lines.push(`- Steps: ${runFinish.stepCount}`);
  }
  if (args.error) {
    lines.push(`- Status: failed`);
  } else {
    lines.push(`- Status: complete`);
  }
  if (runStart?.config) {
    lines.push(`- Max steps: ${runStart.config.maxSteps ?? 'unknown'}`);
    lines.push(`- Deep mode: ${runStart.config.deepMode ? 'true' : 'false'}`);
    lines.push(`- Disable subagents: ${runStart.config.disableSubagents ? 'true' : 'false'}`);
  }
  lines.push('');

  lines.push('## Question');
  lines.push('');
  lines.push('```text');
  lines.push(args.question);
  lines.push('```');
  lines.push('');

  if (runStart?.systemPrompt) {
    lines.push('## System Prompt');
    lines.push('');
    lines.push('```text');
    lines.push(runStart.systemPrompt);
    lines.push('```');
    lines.push('');
  }

  if (runStart?.executionPrompt) {
    lines.push('## Execution Prompt');
    lines.push('');
    lines.push('```text');
    lines.push(runStart.executionPrompt);
    lines.push('```');
    lines.push('');
  }

  if (runStart?.repositoryStructure) {
    lines.push('## Repository Structure Snapshot');
    lines.push('');
    lines.push('```text');
    lines.push(runStart.repositoryStructure);
    lines.push('```');
    lines.push('');
  }

  if (numberedSteps.length > 0 || legacySteps.length > 0) {
    lines.push('## Observable Steps');
    lines.push('');
    const renderedStepNumbers = numberedSteps.length > 0
      ? numberedSteps
      : legacySteps.map(step => step.stepNumber ?? -1);

    for (const stepNumber of renderedStepNumbers) {
      const legacyStep = legacySteps.find(step => (step.stepNumber ?? -1) === stepNumber);
      const stepStart = stepStarts.get(stepNumber);
      const stepFinish = stepFinishes.get(stepNumber);
      const step = stepFinish ?? legacyStep ?? stepStart;

      lines.push(`### Step ${step?.stepNumber ?? '?'}`);
      lines.push('');
      const inputTokens = stepFinish?.usage?.inputTokens ?? step?.usage?.inputTokens ?? 0;
      const outputTokens = stepFinish?.usage?.outputTokens ?? step?.usage?.outputTokens ?? 0;
      const finishReason = stepFinish?.finishReason ?? step?.finishReason ?? 'unknown';
      lines.push(`- Finish reason: ${finishReason}`);
      lines.push(`- Tokens: ${inputTokens} in / ${outputTokens} out`);
      if (typeof stepFinish?.durationMs === 'number') {
        lines.push(`- Duration: ${stepFinish.durationMs} ms`);
      }
      const activeTools = getStepInputContext(stepStart)?.activeTools ?? getStepInputContext(step)?.activeTools ?? [];
      if (activeTools.length > 0) {
        lines.push(`- Active tools: ${activeTools.join(', ')}`);
      }
      lines.push('');

      const assistantOutput = getStepOutputText(stepFinish) ?? getStepOutputText(step);
      if (assistantOutput) {
        lines.push('#### Assistant Output');
        lines.push('');
        lines.push('```text');
        lines.push(assistantOutput);
        lines.push('```');
        lines.push('');
      }

      const toolCalls = getStepToolCalls(stepFinish).length > 0
        ? getStepToolCalls(stepFinish)
        : getStepToolCalls(step);
      if (toolCalls.length > 0) {
        lines.push('#### Tool Calls');
        lines.push('');
        for (const toolCall of toolCalls) {
          lines.push(`- ${toolCall.toolName || 'unknown-tool'}`);
          lines.push('```json');
          lines.push(JSON.stringify(toolCall.input ?? toolCall.args ?? {}, null, 2));
          lines.push('```');
        }
        lines.push('');
      }

      const toolResults = getStepToolResults(stepFinish).length > 0
        ? getStepToolResults(stepFinish)
        : getStepToolResults(step);
      if (toolResults.length > 0) {
        lines.push('#### Tool Results');
        lines.push('');
        for (const toolResult of toolResults) {
          lines.push(`- ${toolResult.toolCallId || 'tool-result'}`);
          lines.push('```json');
          lines.push(JSON.stringify(toolResult.error ?? toolResult.output ?? null, null, 2));
          lines.push('```');
        }
        lines.push('');
      }
    }
  }

  if (args.workerStdout) {
    lines.push('## Worker Stdout');
    lines.push('');
    lines.push('```text');
    lines.push(args.workerStdout);
    lines.push('```');
    lines.push('');
  }

  if (args.workerStderr) {
    lines.push('## Worker Stderr');
    lines.push('');
    lines.push('```text');
    lines.push(args.workerStderr);
    lines.push('```');
    lines.push('');
  }

  if (args.responseText) {
    lines.push('## Raw Codebite Response');
    lines.push('');
    lines.push('```text');
    lines.push(args.responseText);
    lines.push('```');
    lines.push('');
  }

  if (args.finalRawResponse && args.finalRawResponse !== args.responseText) {
    lines.push('## Final Response Used By BatEye');
    lines.push('');
    lines.push('```text');
    lines.push(args.finalRawResponse);
    lines.push('```');
    lines.push('');
  }

  if (runFinish?.finalText) {
    lines.push('## Codebite Final Text');
    lines.push('');
    lines.push('```text');
    lines.push(runFinish.finalText);
    lines.push('```');
    lines.push('');
  }

  if (args.error) {
    lines.push('## Error');
    lines.push('');
    lines.push('```text');
    lines.push(args.error);
    lines.push('```');
    lines.push('');
  }

  lines.push('## Note');
  lines.push('');
  lines.push('This file contains the full observable Codebite run: prompts, tool calls, tool results, assistant text, and final output.');
  lines.push("Provider-hidden chain-of-thought is not available through the runtime, so BatEye logs the complete external trace instead.");
  lines.push('');

  return lines.join('\n');
}

async function parseAndRepairCodebiteOutput<T>(
  rawText: string,
  options: AgenticRepositoryReviewOptions,
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  labelTag: string,
): Promise<{ data: T; rawResponse: string; repairTokensUsed?: TokenUsage }> {
  const extractedJson = extractJsonFromText(rawText);
  const parsed = tryParseAndValidate(extractedJson, schema);
  if ('data' in parsed) {
    return { data: parsed.data, rawResponse: rawText };
  }

  logRuntimeDebug(
    `[codebite]${labelTag} Structured output invalid, attempting repair: ${formatZodErrors(parsed.error)}`,
  );

  const repair = buildStructureRepairPrompt(extractedJson, formatZodErrors(parsed.error));
  const prepared = prepareModel(options);
  const providerOptions = buildProviderOptions(prepared.transport, options.reasoningEffort);
  const generateTextUntyped = generateText as unknown as (
    callOptions: Record<string, unknown>,
  ) => Promise<{ text?: string; usage?: { inputTokens?: number; outputTokens?: number } }>;

  const repairResult = await generateTextUntyped({
    model: prepared.model,
    system: repair.systemPrompt,
    prompt: repair.userMessage,
    maxOutputTokens: options.maxTokens || 8096,
    timeout: Math.min(options.timeoutMs ?? DEFAULT_AGENTIC_TIMEOUT_MS, 60_000),
    maxRetries: 0,
    ...(providerOptions ? { providerOptions } : {}),
  });

  const repairedJson = extractJsonFromText(repairResult.text ?? '');
  const repaired = tryParseAndValidate(repairedJson, schema);
  if ('data' in repaired) {
    const repairTokensUsed = buildRepairTokens(
      repairResult.usage,
      repair.systemPrompt,
      repair.userMessage,
      repairResult.text ?? '',
    );
    return {
      data: repaired.data,
      rawResponse: repairResult.text ?? rawText,
      repairTokensUsed,
    };
  }

  throw new CodebiteStructuredOutputError({
    rawResponse: rawText,
    extractedJson,
    initialError: parsed.error,
    finalError: repaired.error,
    repairResponse: repairResult.text ?? '',
    repairTokensUsed: buildRepairTokens(
      repairResult.usage,
      repair.systemPrompt,
      repair.userMessage,
      repairResult.text ?? '',
    ),
  });
}

function buildRepairTokens(
  usage: { inputTokens?: number; outputTokens?: number } | undefined,
  systemPrompt: string,
  userMessage: string,
  rawResponse: string,
): TokenUsage {
  if (
    usage
    && (typeof usage.inputTokens === 'number' || typeof usage.outputTokens === 'number')
  ) {
    return {
      inputTokens: usage.inputTokens ?? 0,
      outputTokens: usage.outputTokens ?? 0,
      estimated: false,
    };
  }

  return {
    inputTokens: Math.ceil((systemPrompt.length + userMessage.length) / 4),
    outputTokens: Math.ceil(rawResponse.length / 4),
    estimated: true,
  };
}

function mergeCodebiteTokens(
  workerUsage: CodebiteWorkerOutput['usage'],
  question: string,
  rawResponse: string,
  repairTokensUsed?: TokenUsage,
): TokenUsage | undefined {
  const workerHasActualUsage = typeof workerUsage?.inputTokens === 'number' || typeof workerUsage?.outputTokens === 'number';
  const baseUsage: TokenUsage = workerHasActualUsage
    ? {
        inputTokens: workerUsage?.inputTokens ?? 0,
        outputTokens: workerUsage?.outputTokens ?? 0,
        estimated: false,
      }
    : {
        inputTokens: Math.ceil(question.length / 4),
        outputTokens: Math.ceil(rawResponse.length / 4),
        estimated: true,
      };

  if (!repairTokensUsed) {
    return baseUsage;
  }

  return {
    inputTokens: baseUsage.inputTokens + repairTokensUsed.inputTokens,
    outputTokens: baseUsage.outputTokens + repairTokensUsed.outputTokens,
    estimated: baseUsage.estimated || repairTokensUsed.estimated,
  };
}

function addCodebiteTokens(
  total: TokenUsage | undefined,
  addition: TokenUsage | undefined,
): TokenUsage | undefined {
  if (!total) {
    return addition;
  }

  if (!addition) {
    return total;
  }

  return {
    inputTokens: total.inputTokens + addition.inputTokens,
    outputTokens: total.outputTokens + addition.outputTokens,
    estimated: total.estimated || addition.estimated,
  };
}
