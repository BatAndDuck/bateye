import * as fs from 'fs';
import * as path from 'path';
import { Config } from '../../../types/index';
import { CONFIG_FILE, DEFAULT_MODEL, DEFAULT_API_KEY_ENV } from '../../../core/config/defaults';

export type ResolvedConfig = {
  $schema?: string;
  model: string;
  transport: string;
  apiBaseUrl?: string;
  exclude: string[];
  prReview?: Config['prReview'];
};

const VERCEL_OIDC_ENV = 'VERCEL_OIDC_TOKEN';

export function loadConfig(repoPath: string): Config {
  if (!repoPath || typeof repoPath !== 'string') {
    throw new Error('repoPath is required');
  }
  const configPath = path.join(repoPath, CONFIG_FILE);
  if (!fs.existsSync(configPath)) {
    return {};
  }

  try {
    const raw = fs.readFileSync(configPath, 'utf-8');
    return JSON.parse(raw) as Config;
  } catch (err) {
    throw new Error(`Failed to parse ${configPath}: ${(err as Error).message}`);
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
  return {
    $schema: config.$schema,
    model: config.model || DEFAULT_MODEL,
    transport: config.transport || 'auto',
    apiBaseUrl: config.apiBaseUrl,
    exclude: config.exclude || [],
    prReview: config.prReview,
  };
}

export function usesVercelGateway(config: Pick<ResolvedConfig, 'model' | 'transport'>): boolean {
  return config.transport === 'vercel' || config.model.startsWith('vercel/');
}

export function resolveAuthEnvName(config: Pick<ResolvedConfig, 'model' | 'transport'>): string {
  return usesVercelGateway(config) ? VERCEL_OIDC_ENV : DEFAULT_API_KEY_ENV;
}

export function resolveApiKey(config: Pick<ResolvedConfig, 'model' | 'transport'> = {
  model: DEFAULT_MODEL,
  transport: 'auto',
}): string {
  if (usesVercelGateway(config)) {
    // Accept any of the three Vercel credential sources (same priority as the runtime).
    const key = process.env[DEFAULT_API_KEY_ENV]
      || process.env['AI_GATEWAY_API_KEY']
      || process.env[VERCEL_OIDC_ENV];
    if (!key) {
      throw new Error(
        `API key not found. Set ${DEFAULT_API_KEY_ENV}, AI_GATEWAY_API_KEY, or ${VERCEL_OIDC_ENV} environment variable.`
      );
    }
    return key;
  }

  const envName = resolveAuthEnvName(config);
  const key = process.env[envName];
  if (!key) {
    throw new Error(`API key not found. Set the ${envName} environment variable.`);
  }
  return key;
}

const ALLOWED_CONFIG_KEYS: ReadonlySet<keyof Config> = new Set(['$schema', 'model', 'transport', 'apiBaseUrl', 'exclude', 'prReview']);

/**
 * Sets a single field in the repository's CodeOwl config file.
 * @param repoPath - Path to the repository root
 * @param field - Configuration field name (must be one of ALLOWED_CONFIG_KEYS)
 * @param value - New value to assign to the field
 * @throws Error if field is not in ALLOWED_CONFIG_KEYS
 */
export function setConfigField(repoPath: string, field: keyof Config, value: string | string[]): void {
  if (!ALLOWED_CONFIG_KEYS.has(field)) {
    throw new Error(`Unknown config field: ${field}`);
  }
  const config = loadConfig(repoPath);
  (config as Record<string, unknown>)[field] = value;
  saveConfig(repoPath, config);
}
