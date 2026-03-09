import chalk from 'chalk';
import { loadConfig, resolveConfig, setConfigField } from '../../core/config/loader';
import { Config } from '../../types/index';

const ALLOWED_FIELDS: (keyof Config)[] = ['model', 'lightModel', 'apiKeyEnv', 'exclude'];

export async function runConfigShow(repoPath: string): Promise<void> {
  console.log(chalk.cyan('\n🦉 CodeOwl Config\n'));
  const config = resolveConfig(repoPath);

  const rows: [string, string][] = [
    ['model', config.model],
    ['lightModel', config.lightModel],
    ['apiKeyEnv', config.apiKeyEnv],
    ['exclude', JSON.stringify(config.exclude)],
  ];

  for (const [key, val] of rows) {
    console.log(`  ${chalk.white(key.padEnd(14))} ${chalk.gray(val)}`);
  }
  console.log();
}

export async function runConfigSet(repoPath: string, field: string, value: string): Promise<void> {
  const allowed = ALLOWED_FIELDS as string[];
  if (!allowed.includes(field)) {
    throw new Error(`Unknown config field: "${field}". Allowed: ${ALLOWED_FIELDS.join(', ')}`);
  }

  const typedField = field as keyof Config;
  let typedValue: string | string[];

  if (typedField === 'exclude') {
    typedValue = value.split(',').map(s => s.trim()).filter(Boolean);
  } else {
    typedValue = value;
  }

  setConfigField(repoPath, typedField, typedValue);
  console.log(chalk.green(`  ✓ Set ${field} = ${JSON.stringify(typedValue)}`));
}
