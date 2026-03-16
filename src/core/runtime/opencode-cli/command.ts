import * as fs from 'fs';
import * as path from 'path';

export interface OpenCodeInvocation {
  command: string;
  args: string[];
  source: 'bundled' | 'path';
}

interface PackageJsonWithBin {
  bin?: string | Record<string, string>;
}

export function resolveBundledOpenCodeInvocation(
  packageJsonPath: string | null = findBundledOpenCodePackageJson(),
): OpenCodeInvocation | null {
  if (!packageJsonPath) {
    return null;
  }

  const packageDir = path.dirname(packageJsonPath);
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8')) as PackageJsonWithBin;
  const binConfig = packageJson.bin;
  const binRelativePath = typeof binConfig === 'string'
    ? binConfig
    : binConfig?.opencode ?? Object.values(binConfig ?? {})[0];

  if (!binRelativePath) {
    return null;
  }

  const binPath = path.resolve(packageDir, binRelativePath);
  if (!fs.existsSync(binPath)) {
    return null;
  }

  return {
    command: process.execPath,
    args: [binPath],
    source: 'bundled',
  };
}

export function resolveOpenCodeInvocation(): OpenCodeInvocation {
  return resolveBundledOpenCodeInvocation() ?? {
    command: 'opencode',
    args: [],
    source: 'path',
  };
}

function findBundledOpenCodePackageJson(): string | null {
  try {
    return require.resolve('opencode-ai/package.json');
  } catch {
    return null;
  }
}
