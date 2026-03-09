import * as fs from 'fs';
import * as path from 'path';
import { Config } from '../../types/index';
import { CONFIG_FILE, DEFAULT_MODEL, DEFAULT_LIGHT_MODEL, DEFAULT_API_KEY_ENV } from './defaults';

export function loadConfig(repoPath: string): Config {
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

export function resolveConfig(repoPath: string): Required<Omit<Config, '$schema'>> & { $schema?: string } {
  const config = loadConfig(repoPath);
  return {
    $schema: config.$schema,
    model: config.model || DEFAULT_MODEL,
    lightModel: config.lightModel || DEFAULT_LIGHT_MODEL,
    apiKeyEnv: config.apiKeyEnv || DEFAULT_API_KEY_ENV,
    exclude: config.exclude || [],
  };
}

export function getApiKey(apiKeyEnv: string): string {
  const key = process.env[apiKeyEnv];
  if (!key) {
    throw new Error(
      `API key not found. Set the ${apiKeyEnv} environment variable, or update apiKeyEnv in .codeowl/config.json`
    );
  }
  return key;
}

export function setConfigField(repoPath: string, field: keyof Config, value: string | string[]): void {
  const config = loadConfig(repoPath);
  (config as Record<string, unknown>)[field] = value;
  saveConfig(repoPath, config);
}
