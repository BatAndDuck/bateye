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
const zodToJsonSchemaUntyped = zodToJsonSchema as unknown as (
  schema: z.ZodTypeAny,
  name: string,
) => Record<string, unknown>;

export type CodebiteRuntimeConfig = {
  provider: CodebiteProvider;
  model: string;
  apiKey: string;
  maxSteps: number;
  deepMode: boolean;
  tools: {
    tavilyApiKey?: string;
    context7ApiKey?: string;
  };
};

export type CodebiteRuntimeInfo = {
  version: string;
  packageJsonPath: string;
};

type CodebiteWorkerOutput = {
  text?: string;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
  };
};

export function buildCodebiteWorkerScript(packageJsonPath: string): string {
  const packageRoot = path.dirname(packageJsonPath);
  const agentModuleUrl = pathToFileURL(path.join(packageRoot, 'dist', 'agent.js')).href;
  const providerModuleUrl = pathToFileURL(path.join(packageRoot, 'dist', 'provider.js')).href;

  return String.raw`
import { readFile, writeFile } from 'node:fs/promises';
import { runAgent } from ${JSON.stringify(agentModuleUrl)};
import { resolveModel } from ${JSON.stringify(providerModuleUrl)};

const inputPath = process.env.BATEYE_CODEBITE_INPUT;
const outputPath = process.env.BATEYE_CODEBITE_OUTPUT;

if (!inputPath || !outputPath) {
  throw new Error('BATEYE_CODEBITE_INPUT and BATEYE_CODEBITE_OUTPUT are required.');
}

const payload = JSON.parse(await readFile(inputPath, 'utf8'));
const model = resolveModel(payload.config);
const usage = { inputTokens: 0, outputTokens: 0 };

const text = await runAgent({
  model,
  question: payload.question,
  config: payload.config,
  ...(payload.contextDiagnosisPath ? { contextDiagnosisPath: payload.contextDiagnosisPath } : {}),
  onStep: (step) => {
    usage.inputTokens += Number(step.usage?.inputTokens ?? 0);
    usage.outputTokens += Number(step.usage?.outputTokens ?? 0);
  },
});

await writeFile(outputPath, JSON.stringify({ text, usage }, null, 2), 'utf8');
`;
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
  if (options.apiBaseUrl?.trim()) {
    throw new Error(
      'Codebite-backed agentic review does not support custom apiBaseUrl overrides. '
      + `Use one of the native providers: ${formatSupportedCodebiteProviders()}.`
    );
  }

  const target = resolveModelTarget(options.model, options.transport);
  const normalizedTransport = normalizeTransport(target.transport);
  const provider = normalizeCodebiteProvider(normalizedTransport);

  if (!provider) {
    throw new Error(
      `Agentic review does not support transport "${normalizedTransport}". `
      + `Supported providers: ${formatSupportedCodebiteProviders()}.`
    );
  }

  return {
    provider,
    model: target.modelId,
    apiKey: '',
    maxSteps: DEFAULT_CODEBITE_MAX_STEPS,
    deepMode: false,
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
    const question = buildCodebiteQuestion(options, schemaJson);
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bateye-codebite-'));
    const inputPath = path.join(tempDir, 'request.json');
    const outputPath = path.join(tempDir, 'response.json');
    const labelTag = options.callLabel ? ` [${options.callLabel}]` : '';
    const timeoutMs = options.timeoutMs ?? DEFAULT_AGENTIC_TIMEOUT_MS;

    const payload = {
      config: runtimeConfig,
      question,
      contextDiagnosisPath: resolveCodebiteContextDiagnosisPath(options),
    };

    fs.writeFileSync(inputPath, JSON.stringify(payload, null, 2), 'utf-8');

    logRuntimeDebug(
      `[codebite]${labelTag} Starting review: provider=${runtimeConfig.provider}, model=${runtimeConfig.model}, `
      + `questionChars=${question.length}, maxSteps=${runtimeConfig.maxSteps}, timeout=${Math.round(timeoutMs / 1000)}s`,
    );

    try {
      await execa(process.execPath, ['--input-type=module', '--eval', workerScript], {
        cwd: options.repoPath,
        timeout: timeoutMs,
        reject: true,
        env: {
          ...process.env,
          BATEYE_CODEBITE_INPUT: inputPath,
          BATEYE_CODEBITE_OUTPUT: outputPath,
        },
      });

      const workerOutput = JSON.parse(fs.readFileSync(outputPath, 'utf-8')) as CodebiteWorkerOutput;
      const rawText = typeof workerOutput.text === 'string' ? workerOutput.text.trim() : '';
      if (!rawText) {
        throw new Error('Codebite returned an empty response.');
      }

      const parsed = await parseAndRepairCodebiteOutput(rawText, options, schema, labelTag);
      const durationMs = Date.now() - start;
      const tokensUsed = mergeCodebiteTokens(
        workerOutput.usage,
        question,
        parsed.rawResponse,
        parsed.repairTokensUsed,
      );

      if (tokensUsed) {
        const tokenSummary = tokensUsed.estimated
          ? `~${tokensUsed.inputTokens} in + ~${tokensUsed.outputTokens} out (estimated)`
          : `${tokensUsed.inputTokens} in + ${tokensUsed.outputTokens} out`;
        logRuntimeDebug(
          `[codebite]${labelTag} ✓ ${runtimeConfig.provider}/${runtimeConfig.model} completed in ${(durationMs / 1000).toFixed(1)}s: ${tokenSummary}`,
        );
      }

      return {
        data: parsed.data,
        model: options.model,
        runtime: 'cli',
        durationMs,
        rawResponse: parsed.rawResponse,
        tokensUsed,
      };
    } catch (err) {
      const message =
        `Codebite agentic review failed for ${runtimeConfig.provider}/${runtimeConfig.model}: ${formatErrorWithCauses(err)}`;
      throw new Error(message, { cause: err });
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

  return {
    ...supported,
    apiKey: options.apiKey,
    tools: buildCodebiteToolConfig(),
  };
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
): string {
  const seedFiles = options.initialFiles?.length
    ? options.initialFiles.map(file => `- ${file}`).join('\n')
    : '- (none specified)';

  return [
    'You are running inside BatEye as an autonomous repository reviewer.',
    'Investigate the current repository state using the available tools before reporting any finding.',
    'Report only concrete, current issues that still exist in the checked-out repository.',
    'If a suspected issue is unsupported, uncertain, or only present in removed code, omit it.',
    '',
    '## BatEye System Instructions',
    options.systemPrompt,
    '',
    '## BatEye Review Task',
    options.userMessage,
    '',
    '## Suggested Starting Files',
    seedFiles,
    '',
    '## Response Contract',
    'Return ONLY valid JSON that matches this schema. Do not wrap it in markdown fences or add commentary.',
    JSON.stringify(schemaJson, null, 2),
  ].join('\n');
}

function resolveCodebiteContextDiagnosisPath(options: AgenticRepositoryReviewOptions): string | undefined {
  if (process.env.BATEYE_DIAGNOSTIC !== '1') {
    return undefined;
  }

  const diagnosticDir = process.env.BATEYE_DIAGNOSTIC_DIR?.trim()
    ? process.env.BATEYE_DIAGNOSTIC_DIR.trim()
    : path.join(options.repoPath, '.bateye', 'out', 'diagnostics');
  const safeLabel = (options.callLabel || 'agentic-review')
    .replace(/[^a-z0-9._-]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'agentic-review';
  return path.join(diagnosticDir, `${safeLabel}.codebite.jsonl`);
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
    return {
      data: repaired.data,
      rawResponse: repairResult.text ?? rawText,
      repairTokensUsed: buildRepairTokens(repairResult.usage, repair.systemPrompt, repair.userMessage, repairResult.text ?? ''),
    };
  }

  throw repaired.error;
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
