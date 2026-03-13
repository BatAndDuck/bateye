import chalk from 'chalk';
import { resolveConfig, resolveApiKey } from '../../core/config/loader';
import { DirectAIRuntime } from '../../core/runtime/direct/index';
import { parseProviderAndModel } from '../../core/runtime/interface';

export const SUPPORTED_PROVIDERS = [
  // Direct API key providers
  'anthropic', 'openai', 'openrouter', 'google',
  'deepseek', 'groq', 'cerebras', 'together', 'fireworks',
  'xai', 'mistral', 'cohere', 'perplexity', 'minimax',
  'deepinfra', 'huggingface', 'moonshot', 'novita', 'sambanova', 'nebius',
  // Gateway providers
  'vercel',
  // Cloud providers (need extra env vars)
  'azure',              // needs AZURE_RESOURCE_NAME
  // Local providers (no API key needed)
  'ollama', 'lmstudio',
];

export async function runModels(repoPath: string, provider?: string): Promise<void> {
  console.log(chalk.cyan('\n🦉 CodeOwl Models\n'));

  const config = resolveConfig(repoPath);
  let apiKey: string;
  try {
    apiKey = resolveApiKey(config);
  } catch {
    apiKey = '';
  }

  let providers: string[];
  if (provider) {
    const normalised = provider.toLowerCase();
    if (!SUPPORTED_PROVIDERS.includes(normalised)) {
      console.log(chalk.red(`Unknown provider: ${provider}. Supported: ${SUPPORTED_PROVIDERS.join(', ')}`));
      return;
    }
    providers = [normalised];
  } else {
    // Default: show models for the currently configured provider
    const activeTransport = config.transport && config.transport !== 'auto'
      ? config.transport
      : parseProviderAndModel(config.model || 'anthropic/claude-sonnet-4-5').provider;
    providers = [activeTransport];
  }

  const runtime = new DirectAIRuntime();

  for (const p of providers) {
    console.log(chalk.white(`  ${p}:`));
    try {
      const models = await runtime.listModels(
        p,
        apiKey,
        config.transport === p ? config.apiBaseUrl : undefined,
      );
      if (models.length === 0) {
        console.log(chalk.gray('    (no models found — set CODE_OWL_LLM_MODEL_API_KEY and try again)'));
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

  console.log(chalk.gray(`  Current model:  ${config.model || 'anthropic/claude-sonnet-4-5 (default)'}`));
  console.log(chalk.gray(`  Transport:      ${config.transport || 'auto (default)'}`));
  console.log(chalk.gray(`\n  Supported providers: ${SUPPORTED_PROVIDERS.join(', ')}`));
  console.log(chalk.gray(`  To list a provider:  codeowl models <provider>`));
  console.log(chalk.gray(`  To change model:     codeowl config set model anthropic/claude-opus-4-6`));
  console.log();
}
