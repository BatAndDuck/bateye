import { IRuntime } from './interface';
import { DirectAIRuntime } from './direct/index';
import { OpenCodeCLIRuntime } from './opencode-cli/index';

export type RuntimePreference = 'direct' | 'opencode-cli' | 'auto';

let runtimeInstance: IRuntime | null = null;

export async function createRuntime(preference: RuntimePreference = 'auto'): Promise<IRuntime> {
  if (preference === 'opencode-cli') {
    const cli = new OpenCodeCLIRuntime();
    if (await cli.isAvailable()) return cli;
    throw new Error('OpenCode CLI is not available. Install it with: npm i -g opencode-ai');
  }

  if (preference === 'direct') {
    return new DirectAIRuntime();
  }

  // auto: prefer direct, fallback to opencode-cli
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
