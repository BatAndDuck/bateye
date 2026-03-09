import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';
import execa from 'execa';
import { loadConfig, resolveConfig } from '../../core/config/loader';
import { CONFIG_FILE } from '../../core/config/defaults';
import { loadReviewers } from '../../core/reviewers/loader';
import { isGitRepo } from '../../core/git/index';

interface CheckResult {
  label: string;
  status: 'ok' | 'warn' | 'error';
  detail?: string;
}

export async function runDoctor(repoPath: string): Promise<void> {
  console.log(chalk.cyan('\n🦉 CodeOwl Doctor\n'));

  const checks: CheckResult[] = [];

  checks.push({
    label: 'Git repository',
    status: await isGitRepo(repoPath) ? 'ok' : 'warn',
    detail: await isGitRepo(repoPath) ? undefined : 'Not a git repository - some features may not work',
  });

  const configPath = path.join(repoPath, CONFIG_FILE);
  if (fs.existsSync(configPath)) {
    try {
      loadConfig(repoPath);
      checks.push({ label: 'Config file (.codeowl/config.json)', status: 'ok' });
    } catch (err) {
      checks.push({ label: 'Config file (.codeowl/config.json)', status: 'error', detail: (err as Error).message });
    }
  } else {
    checks.push({ label: 'Config file (.codeowl/config.json)', status: 'warn', detail: 'Not found - run `codeowl init`' });
  }

  const config = resolveConfig(repoPath);
  if (config.apiKey) {
    checks.push({ label: 'API key (config.apiKey)', status: 'ok', detail: '***' + config.apiKey.slice(-4) });
  } else {
    const apiKey = process.env[config.apiKeyEnvVariable];
    if (apiKey) {
      checks.push({ label: `API key (${config.apiKeyEnvVariable})`, status: 'ok', detail: '***' + apiKey.slice(-4) });
    } else {
      checks.push({
        label: `API key (${config.apiKeyEnvVariable})`,
        status: 'error',
        detail: `${config.apiKeyEnvVariable} is not set and config.apiKey is empty`,
      });
    }
  }

  checks.push({
    label: 'Model',
    status: 'ok',
    detail: config.model,
  });

  checks.push({
    label: 'Light model (orchestration)',
    status: 'ok',
    detail: config.lightModel,
  });

  const { reviewers, warnings } = loadReviewers(repoPath);
  checks.push({
    label: `Reviewers (${reviewers.length} loaded)`,
    status: reviewers.length > 0 ? 'ok' : 'warn',
    detail: reviewers.length > 0 ? reviewers.map(r => r.id).join(', ') : 'No reviewers found',
  });
  for (const w of warnings) {
    checks.push({ label: 'Reviewer warning', status: 'warn', detail: w });
  }

  try {
    const result = await execa('opencode', ['--version'], { timeout: 3000 });
    checks.push({ label: 'OpenCode CLI', status: 'ok', detail: result.stdout.trim() });
  } catch {
    checks.push({ label: 'OpenCode CLI (optional)', status: 'warn', detail: 'Not found - using direct AI SDK (fine for most uses)' });
  }

  let hasErrors = false;
  for (const check of checks) {
    const icon = check.status === 'ok' ? chalk.green('✓') : check.status === 'warn' ? chalk.yellow('⚠') : chalk.red('✗');
    const label = check.status === 'error' ? chalk.red(check.label) : check.status === 'warn' ? chalk.yellow(check.label) : chalk.white(check.label);
    const detail = check.detail ? chalk.gray(' - ' + check.detail) : '';
    console.log(`  ${icon}  ${label}${detail}`);
    if (check.status === 'error') hasErrors = true;
  }

  console.log();
  if (hasErrors) {
    console.log(chalk.red('  ✗ Some checks failed. Fix the errors above before running CodeOwl.'));
  } else {
    console.log(chalk.green('  ✓ Ready to run CodeOwl!'));
  }
  console.log();
}
