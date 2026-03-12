import chalk from 'chalk';
import { Config } from '../../../types/index';
import { resolveConfig, setConfigField } from '../application/config-service';

const ALLOWED_FIELDS: (keyof Config)[] = ['model', 'transport', 'apiBaseUrl', 'exclude'];

export async function runConfigShow(repoPath: string): Promise<void> {
  console.log(chalk.cyan('\n🦉 CodeOwl Config\n'));
  const config = resolveConfig(repoPath);

  const rows: [string, string][] = [
    ['model', config.model],
    ['apiKeyEnv', 'CODE_OWL_LLM_MODEL_API_KEY'],
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
