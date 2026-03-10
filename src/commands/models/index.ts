import chalk from 'chalk';
import { resolveConfig, resolveApiKey } from '../../core/config/loader';
import { DirectAIRuntime } from '../../core/runtime/direct/index';

const KNOWN_PROVIDERS = ['anthropic', 'openai'];

export async function runModels(repoPath: string, provider?: string): Promise<void> {
  console.log(chalk.cyan('\n🦉 CodeOwl Models\n'));

  const config = resolveConfig(repoPath);
  let apiKey: string;
  try {
    apiKey = resolveApiKey(config);
  } catch {
    apiKey = '';
  }

  const runtime = new DirectAIRuntime();
  const providers = provider ? [provider.toLowerCase()] : KNOWN_PROVIDERS;

  for (const p of providers) {
    console.log(chalk.white(`  ${p}:`));
    try {
      const models = await runtime.listModels(p, apiKey);
      if (models.length === 0) {
        console.log(chalk.gray('    (no models found)'));
      } else {
        for (const m of models) {
          const isCurrent = m === config.model;
          console.log(`    ${isCurrent ? chalk.cyan('→') : ' '} ${m}${isCurrent ? chalk.cyan(' (configured)') : ''}`);
        }
      }
    } catch (err) {
      console.log(chalk.red(`    Error: ${(err as Error).message}`));
    }
    console.log();
  }

  console.log(chalk.gray(`  Current model:  ${config.model}`));
  console.log(chalk.gray(`\n  To change: codeowl config set model anthropic/claude-opus-4-6`));
  console.log();
}
