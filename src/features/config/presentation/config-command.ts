import chalk from 'chalk';
import { Config } from '../../../types/index';
import { resolveAuthEnvName, resolveConfig, setConfigField } from '../application/config-service';
import {
  maskApiKey,
  resolveCredentialStorePath,
  resolveStoredApiKey,
  saveRepoApiKey,
} from '../application/credential-store';

const ALLOWED_FIELDS: (keyof Config)[] = ['model', 'transport', 'apiBaseUrl', 'exclude'];

export async function runConfigShow(repoPath: string): Promise<void> {
  console.log(chalk.cyan('\n🦉 BatEye Config\n'));
  const config = resolveConfig(repoPath);
  const storedApiKey = resolveStoredApiKey(repoPath);

  const rows: [string, string][] = [
    ['model', config.model],
    ['apiKeyEnv', resolveAuthEnvName(config)],
    ['storedApiKey', storedApiKey ? maskApiKey(storedApiKey) : '(not stored)'],
    ['transport', config.transport],
    ['apiBaseUrl', config.apiBaseUrl || '(default)'],
    ['exclude', JSON.stringify(config.exclude)],
  ];

  for (const [key, val] of rows) {
    console.log(`  ${chalk.white(key.padEnd(18))} ${chalk.gray(val)}`);
  }
  console.log();
}

export async function runConfigSet(repoPath: string, field: string, value: string): Promise<void> {
  const allowed = ALLOWED_FIELDS as string[];
  if (!allowed.includes(field)) {
    throw new Error(`Unknown config field: "${field}". Allowed: ${ALLOWED_FIELDS.join(', ')}`);
  }

  const typedField = field as keyof Config;
  const typedValue = typedField === 'exclude'
    ? value.split(',').map(segment => segment.trim()).filter(Boolean)
    : value;

  setConfigField(repoPath, typedField, typedValue);
  console.log(chalk.green(`  ✓ Set ${field} = ${JSON.stringify(typedValue)}`));
}

type RunConfOptions = {
  apiKey?: string;
  model?: string;
};

export async function runConf(repoPath: string, options: RunConfOptions): Promise<void> {
  const model = options.model?.trim();
  const apiKey = options.apiKey?.trim();

  if (!model && !apiKey) {
    await runConfigShow(repoPath);
    return;
  }

  if (model) {
    setConfigField(repoPath, 'model', model);
    console.log(chalk.green(`  ✓ Set model = ${JSON.stringify(model)}`));
  }

  if (apiKey) {
    saveRepoApiKey(repoPath, apiKey);
    console.log(
      chalk.green(
        `  ✓ Stored API key ${maskApiKey(apiKey)} for this repository in ${resolveCredentialStorePath()}`
      )
    );
  }
}
