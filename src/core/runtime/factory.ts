import { IRuntime } from './interface';
import { DirectAIRuntime } from './direct/index';
import { OpenCodeCLIRuntime } from './opencode-cli/index';
import { MockRuntime } from '../../features/shared/runtime/mock-runtime';

export type RuntimePreference = 'direct' | 'opencode-cli' | 'mock' | 'auto';

let runtimeInstance: IRuntime | null = null;

export async function createRuntime(preference: RuntimePreference = 'auto'): Promise<IRuntime> {
  const effectivePreference = preference === 'auto' && process.env.CODEOWL_RUNTIME === 'mock'
    ? 'mock'
    : preference;

  if (effectivePreference === 'mock') {
    return new MockRuntime();
  }

  if (effectivePreference === 'opencode-cli') {
    const cli = new OpenCodeCLIRuntime();
    if (await cli.isAvailable()) return cli;
    throw new Error('OpenCode CLI is not available. Install it with: npm i -g opencode-ai');
  }

  if (effectivePreference === 'direct') {
    return new DirectAIRuntime();
  }

  return new DirectAIRuntime();
}

export async function getRuntime(): Promise<IRuntime> {
  if (!runtimeInstance) {
    runtimeInstance = await createRuntime('auto');
  }
  return runtimeInstance;
}

export function resetRuntime(): void {
  runtimeInstance = null;
}
