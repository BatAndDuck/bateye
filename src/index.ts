#!/usr/bin/env node
installProcessWarningFilter();
void main().catch(err => {
  const message = err instanceof Error ? err.stack || err.message : String(err);
  console.error(message);
  process.exitCode = 1;
});

async function main(): Promise<void> {
  const { createCLI } = await import('./cli/index');
  const program = createCLI();
  program.parse(normalizeCliArgs(process.argv));
}

function normalizeCliArgs(argv: string[]): string[] {
  const commands = new Set(['init', 'doctor', 'models', 'config', 'conf', 'reviewers', 'audit', 'pr-review']);
  const normalized = [...argv];

  for (let i = 2; i < normalized.length - 1; i++) {
    if (normalized[i] === '--diagnostic' && commands.has(normalized[i + 1])) {
      normalized.splice(i + 1, 0, '.bateye/out/diagnostics');
      i++;
    }
  }

  return normalized;
}

function installProcessWarningFilter(): void {
  const originalEmitWarning = process.emitWarning as (...args: unknown[]) => void;
  process.emitWarning = ((warning: unknown, ...args: unknown[]) => {
    const code = typeof args[1] === 'string'
      ? args[1]
      : typeof args[0] === 'object' && args[0] !== null && 'code' in args[0]
        ? String((args[0] as { code?: unknown }).code ?? '')
        : '';
    const message = warning instanceof Error ? warning.message : String(warning);

    if (code === 'DEP0040' || /The `punycode` module is deprecated/i.test(message)) {
      return;
    }

    originalEmitWarning(warning, ...args);
  }) as typeof process.emitWarning;
}
