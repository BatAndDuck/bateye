import * as fs from 'fs';
import * as path from 'path';
import { Config } from '../../../types/index';
import { CONFIG_FILE, DEFAULT_MODEL, DEFAULT_API_KEY_ENV } from '../../../core/config/defaults';
import { resolveStoredApiKey } from './credential-store';

export type ResolvedConfig = {
  $schema?: string;
  model: string;
  transport: string;
  apiBaseUrl?: string;
  exclude: string[];
  prReview?: Config['prReview'];
  disabledReviewers?: Config['disabledReviewers'];
};

const VERCEL_OIDC_ENV = 'VERCEL_OIDC_TOKEN';
const VERCEL_GATEWAY_ENV_NAMES = [DEFAULT_API_KEY_ENV, 'AI_GATEWAY_API_KEY', VERCEL_OIDC_ENV] as const;

export function loadConfig(repoPath: string): Config {
  if (!repoPath || typeof repoPath !== 'string') {
    throw new Error('repoPath is required');
  }
  const configPath = path.join(repoPath, CONFIG_FILE);
  if (!fs.existsSync(configPath)) {
    return {};
  }

  let raw = '';
  try {
    raw = fs.readFileSync(configPath, 'utf-8');
    return JSON.parse(raw) as Config;
  } catch (err) {
    throw new Error(`Failed to parse ${configPath}: ${(err as Error).message}\nFile contents: ${raw}`, { cause: err });
  }
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
    transport: config.transport !== undefined ? config.transport : 'auto',
    apiBaseUrl: config.apiBaseUrl,
    exclude: config.exclude || [],
    prReview: config.prReview,
    disabledReviewers: config.disabledReviewers,
  };
}

function usesVercelGateway(config: Pick<ResolvedConfig, 'model' | 'transport'>): boolean {
  return config.transport === 'vercel' || config.model.startsWith('vercel/');
}

export function resolveAuthEnvName(config: Pick<ResolvedConfig, 'model' | 'transport'>): string {
  return usesVercelGateway(config) ? VERCEL_OIDC_ENV : DEFAULT_API_KEY_ENV;
}

/** Resolve the API credential required for the selected runtime transport and model. */
export function resolveApiKey(config: Pick<ResolvedConfig, 'model' | 'transport'> = {
  model: DEFAULT_MODEL,
  transport: 'auto',
}, repoPath = process.cwd()): string {
  if (usesVercelGateway(config)) {
    // Accept any of the three Vercel credential sources (same priority as the runtime).
    const key = process.env[DEFAULT_API_KEY_ENV]
      || process.env['AI_GATEWAY_API_KEY']
      || process.env[VERCEL_OIDC_ENV]
      || resolveStoredApiKey(repoPath);
    if (!key) {
      throw new Error(`API key not found. Set one of: ${VERCEL_GATEWAY_ENV_NAMES.join(', ')}.`);
    }
    return key;
  }

  const envName = resolveAuthEnvName(config);
  const key = process.env[envName] || resolveStoredApiKey(repoPath);
  if (!key) {
    throw new Error(`API key not found. Set ${envName} or configure it with \`bateye conf --apikey ...\`.`);
  }
  process.env[envName] = key;
  return key;
}

const ALLOWED_CONFIG_KEYS: ReadonlySet<keyof Config> = new Set([
  '$schema',
  'model',
  'transport',
  'apiBaseUrl',
  'exclude',
  'prReview',
  'disabledReviewers',
]);

/**
 * Sets a single field in the repository's BatEye config file.
 * @param repoPath - Path to the repository root
 * @param field - Configuration field name. Allowed values: '$schema', 'model', 'transport', 'apiBaseUrl', 'exclude', 'prReview', 'disabledReviewers'
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

  loadConfig(repoPath);
  const updated = { [field]: value } as Config;
  saveConfig(repoPath, updated);
}
