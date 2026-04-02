import * as path from 'path';

export function isDiagnosticModeEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const value = env.BATEYE_DIAGNOSTIC;
  return typeof value === 'string' && /^(1|true|yes|on)$/i.test(value);
}

export function resolveDiagnosticDir(
  repoPath: string,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  if (!isDiagnosticModeEnabled(env)) {
    return undefined;
  }

  const explicitDir = env.BATEYE_DIAGNOSTIC_DIR?.trim();
  if (explicitDir) {
    return path.resolve(explicitDir);
  }

  return path.join(path.resolve(repoPath), '.bateye', 'out', 'diagnostics');
}
