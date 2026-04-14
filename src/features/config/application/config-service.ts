import * as fs from 'fs';
import * as path from 'path';
import { Config } from '../../../types/index';
import {
  CONFIG_FILE,
  CONFIG_LOCAL_FILE,
  DEFAULT_MODEL,
  DEFAULT_API_KEY_ENV,
} from '../../../core/config/defaults';
import { resolveStoredApiKey } from './credential-store';

export type ResolvedConfig = {
  $schema?: string;
  model: string;
  apiKey?: string;
  transport: string;
  apiBaseUrl?: string;
  githubToken?: string;
  exclude: string[];
  prReview?: Config['prReview'];
  disabledReviewers?: Config['disabledReviewers'];
  reasoningEffort?: string;
};

const VERCEL_OIDC_ENV = 'VERCEL_OIDC_TOKEN';
const VERCEL_GATEWAY_ENV_NAMES = [DEFAULT_API_KEY_ENV, 'AI_GATEWAY_API_KEY', VERCEL_OIDC_ENV] as const;
const CONFIG_FILES = [CONFIG_FILE, CONFIG_LOCAL_FILE] as const;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function optionalString(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function mergeConfig(base: Config, override: Config): Config {
  const merged: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(override)) {
    const current = merged[key];
    merged[key] = isPlainObject(current) && isPlainObject(value)
      ? mergeConfig(current as Config, value as Config)
      : value;
  }
  return merged as Config;
}

function readConfigFile(repoPath: string, configFile: string): Config | undefined {
  const configPath = path.join(repoPath, configFile);
  if (!fs.existsSync(configPath)) {
    return undefined;
  }

  try {
    const raw = fs.readFileSync(configPath, 'utf-8');
    return JSON.parse(raw) as Config;
  } catch (err) {
    throw new Error(`Failed to parse ${configPath}: ${(err as Error).message}`, { cause: err });
  }
}

export function loadConfig(repoPath: string): Config {
  if (!repoPath || typeof repoPath !== 'string') {
    throw new Error('repoPath is required');
  }

  return CONFIG_FILES.reduce<Config>((config, configFile) => {
    const fileConfig = readConfigFile(repoPath, configFile);
    return fileConfig ? mergeConfig(config, fileConfig) : config;
  }, {});
}

export function saveConfig(repoPath: string, config: Config): void {
  const configPath = path.join(repoPath, CONFIG_FILE);
  const dir = path.dirname(configPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');
}

export function resolveConfig(
  repoPath: string,
): ResolvedConfig {
  const config = loadConfig(repoPath);
  const model = config.model || DEFAULT_MODEL;
  return {
    $schema: config.$schema,
    model,
    apiKey: optionalString(config.apiKey),
    transport: config.transport || 'auto',
    apiBaseUrl: config.apiBaseUrl,
    githubToken: optionalString(config.githubToken),
    exclude: config.exclude || [],
    prReview: config.prReview,
    disabledReviewers: config.disabledReviewers,
    reasoningEffort: config.reasoningEffort,
  };
}

function usesVercelGateway(config: Pick<ResolvedConfig, 'model' | 'transport'>): boolean {
  return config.transport === 'vercel' || config.model.startsWith('vercel/');
}

export function resolveAuthEnvName(config: Pick<ResolvedConfig, 'model' | 'transport'>): string {
  return usesVercelGateway(config) ? VERCEL_OIDC_ENV : DEFAULT_API_KEY_ENV;
}

/** Resolve the API credential required for the selected runtime transport and model. */
export function resolveApiKey(config: Pick<ResolvedConfig, 'model' | 'transport' | 'apiKey'> = {
  model: DEFAULT_MODEL,
  transport: 'auto',
}, repoPath = process.cwd()): string {
  const configApiKey = optionalString(config.apiKey);

  if (usesVercelGateway(config)) {
    // Accept any of the three Vercel credential sources (same priority as the runtime).
    const key = configApiKey
      || process.env[DEFAULT_API_KEY_ENV]
      || process.env['AI_GATEWAY_API_KEY']
      || process.env[VERCEL_OIDC_ENV]
      || resolveStoredApiKey(repoPath);
    if (!key) {
      throw new Error(`API key not found. Set one of: ${VERCEL_GATEWAY_ENV_NAMES.join(', ')}, or put apiKey in .bateye/config.local.json.`);
    }
    return key;
  }

  const envName = resolveAuthEnvName(config);
  const key = configApiKey || process.env[envName] || resolveStoredApiKey(repoPath);
  if (!key) {
    throw new Error(`API key not found. Set ${envName}, put apiKey in .bateye/config.local.json, or configure it with \`bateye conf --apikey ...\`.`);
  }
  return key;
}

export function resolveGitHubToken(
  config?: Pick<ResolvedConfig, 'githubToken'>,
  explicitToken?: string,
): string | undefined {
  return optionalString(explicitToken)
    || optionalString(config?.githubToken)
    || optionalString(process.env.GITHUB_TOKEN)
    || undefined;
}

const ALLOWED_CONFIG_KEYS: ReadonlySet<keyof Config> = new Set([
  '$schema',
  'model',
  'transport',
  'apiBaseUrl',
  'exclude',
  'prReview',
  'disabledReviewers',
  'reasoningEffort',
]);

/**
 * Sets a single field in the repository's BatEye config file.
 * @param repoPath - Path to the repository root
 * @param field - Configuration field name. Allowed values: '$schema', 'model', 'transport', 'apiBaseUrl', 'exclude', 'prReview', 'disabledReviewers', 'reasoningEffort'
 * @param value - New value to assign to the field
 * @throws Error if field is not one of the allowed config keys
 */
export function setConfigField(repoPath: string, field: keyof Config, value: string | string[]): void {
  if (!ALLOWED_CONFIG_KEYS.has(field)) {
    throw new Error(`Unknown config field: ${field}`);
  }

  if (field === 'exclude' || field === 'disabledReviewers') {
    if (!Array.isArray(value)) {
      throw new Error(`Config field "${field}" must be an array of non-empty strings.`);
    }
    const invalidEntry = value.find(entry => typeof entry !== 'string' || entry.trim().length === 0);
    if (invalidEntry !== undefined) {
      throw new Error(`Config field "${field}" must contain only non-empty strings.`);
    }
  } else if (Array.isArray(value)) {
    throw new Error(`Config field "${field}" does not accept an array value.`);
  }

  // Validate all active config files first so the command does not silently
  // succeed while a malformed local override still breaks normal execution.
  loadConfig(repoPath);
  const config = readConfigFile(repoPath, CONFIG_FILE) ?? {};
  Object.assign(config, { [field]: value });
  saveConfig(repoPath, config);
}
