import * as fs from 'fs';
import * as path from 'path';
import { Config } from '../../../types/index';
import { CONFIG_FILE, DEFAULT_MODEL, DEFAULT_LIGHT_MODEL, DEFAULT_API_KEY_ENV } from '../../../core/config/defaults';

type LegacyConfig = Config & {
  apiKeyEnv?: string;
};

export function loadConfig(repoPath: string): Config {
  const configPath = path.join(repoPath, CONFIG_FILE);
  if (!fs.existsSync(configPath)) {
    return {};
  }

  try {
    const raw = fs.readFileSync(configPath, 'utf-8');
    return JSON.parse(raw) as LegacyConfig;
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

export function resolveConfig(repoPath: string): Required<Omit<Config, '$schema' | 'apiKey'>> & { $schema?: string; apiKey?: string } {
  const config = loadConfig(repoPath);
  const legacyConfig = config as LegacyConfig;
  return {
    $schema: config.$schema,
    model: config.model || DEFAULT_MODEL,
    lightModel: config.lightModel || DEFAULT_LIGHT_MODEL,
    apiKey: config.apiKey,
    apiKeyEnvVariable: config.apiKeyEnvVariable || legacyConfig.apiKeyEnv || DEFAULT_API_KEY_ENV,
    exclude: config.exclude || [],
  };
}

export function resolveApiKey(config: { apiKey?: string; apiKeyEnvVariable: string }): string {
  if (config.apiKey) return config.apiKey;

  const key = process.env[config.apiKeyEnvVariable];
  if (!key) {
    throw new Error(
      `API key not found. Set the ${config.apiKeyEnvVariable} environment variable, or set apiKey/apiKeyEnvVariable in .codeowl/config.json`
    );
  }

  return key;
}

export function setConfigField(repoPath: string, field: keyof Config, value: string | string[]): void {
  const config = loadConfig(repoPath);
  (config as Record<string, unknown>)[field] = value;
  saveConfig(repoPath, config);
}
