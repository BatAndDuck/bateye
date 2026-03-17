#!/usr/bin/env node
installProcessWarningFilter();
void main();

async function main(): Promise<void> {
  const { createCLI } = await import('./cli/index');
  const program = createCLI();
  program.parse(process.argv);
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
