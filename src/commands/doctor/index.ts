import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';
import { loadConfig, resolveConfig } from '../../core/config/loader';
import { CONFIG_FILE, CONFIG_LOCAL_FILE } from '../../core/config/defaults';
import { loadReviewers } from '../../core/reviewers/loader';
import { isGitRepo } from '../../core/git/index';
import { resolveApiKey, resolveAuthEnvName } from '../../features/config/application/config-service';
import { maskApiKey, resolveStoredApiKey } from '../../features/config/application/credential-store';
import { resolveCodebiteRuntimeInfo } from '../../core/runtime/codebite/index';
import { BATEYE_VERSION } from '../../version';

interface CheckResult {
  label: string;
  status: 'ok' | 'warn' | 'error';
  detail?: string;
  /** Actionable fix suggestion printed indented below the check line. */
  suggestion?: string;
}

export async function runDoctor(repoPath: string): Promise<void> {
  console.log(chalk.cyan('\n🦇 BatEye Doctor') + chalk.gray(`  v${BATEYE_VERSION}`) + '\n');

  const checks: CheckResult[] = [];

  const isGit = await isGitRepo(repoPath);
  checks.push({
    label: 'Git repository',
    status: isGit ? 'ok' : 'warn',
    detail: isGit ? undefined : 'Not a git repository',
    suggestion: isGit ? undefined : 'PR review requires a git repository. Run `git init` if needed.',
  });

  const configFiles = [CONFIG_FILE, CONFIG_LOCAL_FILE];
  const existingConfigFiles = configFiles.filter(configFile => fs.existsSync(path.join(repoPath, configFile)));
  const configLabel = 'Config files (.bateye/config.json, .bateye/config.local.json)';
  if (existingConfigFiles.length > 0) {
    try {
      loadConfig(repoPath);
      checks.push({
        label: configLabel,
        status: 'ok',
        detail: `Loaded ${existingConfigFiles.join(', ')}`,
      });
    } catch (err) {
      checks.push({
        label: configLabel,
        status: 'error',
        detail: (err as Error).message,
        suggestion: 'Fix the JSON syntax error in .bateye/config.json or .bateye/config.local.json, or delete the broken file and run `bateye init`.',
      });
    }
  } else {
    checks.push({
      label: configLabel,
      status: 'warn',
      detail: 'Not found',
      suggestion: 'Run `bateye init` to create the config file and directory structure.',
    });
  }

  const config = resolveConfig(repoPath);
  const authEnv = resolveAuthEnvName(config);
  const envApiKey = process.env[authEnv]?.trim() || undefined;
  const configuredApiKey = config.apiKey?.trim() || undefined;
  const storedApiKey = resolveStoredApiKey(repoPath);
  const apiKey = (() => {
    try {
      return resolveApiKey(config, repoPath);
    } catch {
      return undefined;
    }
  })();

  if (apiKey) {
    const detail = configuredApiKey && apiKey === configuredApiKey
      ? `${maskApiKey(apiKey)} from BatEye config`
      : envApiKey && apiKey === envApiKey
      ? `${maskApiKey(apiKey)} from ${authEnv}`
      : storedApiKey && apiKey === storedApiKey
        ? `${maskApiKey(apiKey)} from BatEye credential store`
        : maskApiKey(apiKey);
    checks.push({ label: `API key (${authEnv})`, status: 'ok', detail });
  } else {
    checks.push({
      label: `API key (${authEnv})`,
      status: 'error',
      detail: `${authEnv} not set and no stored credential found`,
      suggestion: `export ${authEnv}=your_key   OR   bateye conf --apikey your_key`,
    });
  }

  checks.push({ label: 'Model', status: 'ok', detail: config.model });
  checks.push({ label: 'Transport', status: 'ok', detail: config.transport });

  if (config.apiBaseUrl) {
    checks.push({ label: 'API base URL', status: 'ok', detail: config.apiBaseUrl });
  }

  const { reviewers, warnings } = loadReviewers(repoPath);
  checks.push({
    label: `Reviewers (${reviewers.length} loaded)`,
    status: reviewers.length > 0 ? 'ok' : 'warn',
    detail: reviewers.length > 0 ? reviewers.map(r => r.id).join(', ') : 'No reviewers found',
    suggestion: reviewers.length === 0
      ? 'Built-in reviewers should load automatically. Reinstall BatEye if they are missing.'
      : undefined,
  });
  for (const w of warnings) {
    checks.push({
      label: 'Reviewer warning',
      status: 'warn',
      detail: w,
      suggestion: 'Check the reviewer file for YAML front-matter or Markdown formatting issues.',
    });
  }

  const codebiteInfo = resolveCodebiteRuntimeInfo();
  if (codebiteInfo) {
    checks.push({
      label: 'Codebite runtime',
      status: 'ok',
      detail: `${codebiteInfo.version} (bundled with BatEye)`,
    });
  } else {
    checks.push({
      label: 'Codebite runtime (agentic review)',
      status: 'warn',
      detail: 'Not available',
      suggestion: 'Reinstall BatEye dependencies with `npm install`, `npm ci`, or `npm install -g bateye`.',
    });
  }

  let hasErrors = false;
  for (const check of checks) {
    const icon = check.status === 'ok'
      ? chalk.green('✓')
      : check.status === 'warn'
        ? chalk.yellow('⚠')
        : chalk.red('✗');
    const label = check.status === 'error'
      ? chalk.red(check.label)
      : check.status === 'warn'
        ? chalk.yellow(check.label)
        : chalk.white(check.label);
    const detail = check.detail ? chalk.gray(' - ' + check.detail) : '';
    console.log(`  ${icon}  ${label}${detail}`);
    if (check.suggestion) {
      console.log(chalk.gray(`       Fix: ${check.suggestion}`));
    }
    if (check.status === 'error') hasErrors = true;
  }

  console.log();
  if (hasErrors) {
    console.log(chalk.red('  ✗ Some checks failed. Fix the errors above before running BatEye.'));
  } else {
    console.log(chalk.green('  ✓ Ready to run BatEye!'));
  }
  console.log();
}
