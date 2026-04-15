import chalk from 'chalk';
import { resolveConfig, resolveApiKey } from '../../core/config/loader';
import { DirectAIRuntime } from '../../core/runtime/direct/index';
import { parseProviderAndModel } from '../../core/runtime/interface';
import {
  formatSupportedCodebiteProviders,
  normalizeCodebiteProvider,
  SUPPORTED_CODEBITE_PROVIDERS,
} from '../../core/runtime/codebite/models';
import { resolveAuthEnvName } from '../../features/config/application/config-service';

export const SUPPORTED_PROVIDERS = [...SUPPORTED_CODEBITE_PROVIDERS];

export async function runModels(repoPath: string, provider?: string, all?: boolean): Promise<void> {
  console.log(chalk.cyan('\n🦇 BatEye Models\n'));

  const config = resolveConfig(repoPath);
  const authEnv = resolveAuthEnvName(config);
  let apiKey: string;
  try {
    apiKey = resolveApiKey(config, repoPath);
  } catch (err) {
    apiKey = '';
    console.log(chalk.yellow(`  ! ${(err as Error).message}`));
    console.log(chalk.gray('    Model listing will be limited without an API key.\n'));
  }

  // Determine the effective provider for the configured model.
  const configuredProvider = config.transport !== 'auto'
    ? config.transport
    : parseProviderAndModel(config.model).provider;
  const normalizedConfiguredProvider = normalizeCodebiteProvider(configuredProvider);

  let providers: string[];
  if (provider) {
    const normalised = normalizeCodebiteProvider(provider);
    if (!normalised) {
      console.log(chalk.red(`Unknown provider: ${provider}. Supported: ${formatSupportedCodebiteProviders()}`));
      return;
    }
    providers = [normalised];
  } else if (all) {
    providers = SUPPORTED_PROVIDERS;
  } else if (!normalizedConfiguredProvider) {
    console.log(chalk.yellow(`  ! Current config uses ${configuredProvider}, which is not supported by the Codebite-backed agentic runtime.`));
    console.log(chalk.gray(`    Supported providers: ${formatSupportedCodebiteProviders()}\n`));
    providers = SUPPORTED_PROVIDERS;
  } else {
    // Default: show models for the currently configured provider
    providers = [normalizedConfiguredProvider];
  }

  const runtime = new DirectAIRuntime();

  for (const p of providers) {
    console.log(chalk.white(`  ${p}:`));
    try {
      const models = await runtime.listModels(
        p,
        apiKey,
        p === normalizedConfiguredProvider ? config.apiBaseUrl : undefined,
      );
      if (models.length === 0) {
        if (config.apiBaseUrl && p === normalizedConfiguredProvider) {
          console.log(chalk.gray(`    (no models found from ${config.apiBaseUrl.replace(/\/$/, '')}/models)`));
          console.log(chalk.gray(`    Set the model directly: bateye conf --model ${p}/your-model-id`));
        } else {
          console.log(chalk.gray(`    (no models found — set ${authEnv} or run \`bateye conf --apikey ...\`)`));
        }
      } else {
        for (const m of models) {
          const isCurrent = m === config.model || `${p}/${m}` === config.model;
          console.log(`    ${isCurrent ? chalk.cyan('→') : ' '} ${m}${isCurrent ? chalk.cyan(' (configured)') : ''}`);
        }
      }
    } catch (err) {
      console.log(chalk.red(`    Error: ${(err as Error).message}`));
    }
    console.log();
  }

  console.log(chalk.gray(`  Current model:  ${config.model || 'vercel/openai/gpt-5.4-nano (default)'}`));
  console.log(chalk.gray(`  Transport:      ${config.transport || 'auto (default)'}`));
  console.log(chalk.gray(`\n  Supported providers: ${formatSupportedCodebiteProviders()}`));
  console.log(chalk.gray(`  To list a provider:  bateye models <provider>`));
  console.log(chalk.gray(`  To list all:         bateye models --all`));
  console.log(chalk.gray(`  Quick setup:         bateye conf --model vercel/openai/gpt-5.4-nano --apikey <key>`));
  console.log(chalk.gray(`  To change model:     bateye config set model vercel/openai/gpt-5.4-nano`));
  console.log();
}
