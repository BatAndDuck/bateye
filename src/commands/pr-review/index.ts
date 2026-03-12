import chalk from 'chalk';
import ora from 'ora';
import { runPRReview } from '../../core/pr-review/runner';
import { PRReviewResult } from '../../types/index';

export interface PRReviewCommandOptions {
  base?: string;
  head?: string;
  github?: boolean;
  token?: string;
  prNumber?: string;
  dryRun?: boolean;
}

export async function runPRReviewCommand(repoPath: string, options: PRReviewCommandOptions): Promise<void> {
  console.log(chalk.cyan('\n🦉 CodeOwl PR Review\n'));

  const spinner = ora({ text: 'Starting PR review...', color: 'cyan' }).start();

  let result: PRReviewResult;
  try {
    result = await runPRReview({
      repoPath,
      baseRef: options.base,
      headRef: options.head,
      github: options.github,
      githubToken: options.token,
      prNumber: options.prNumber ? parseInt(options.prNumber, 10) : undefined,
      dryRun: options.dryRun,
      onProgress: msg => { spinner.text = msg; },
    });
  } catch (err) {
    spinner.fail(chalk.red(`PR review failed: ${(err as Error).message}`));
    process.exit(1);
  }

  spinner.succeed(chalk.green('PR review complete'));
  printPRReviewSummary(result);
}

function printPRReviewSummary(result: PRReviewResult): void {
  const counts = {
    critical: result.findings.filter(f => f.priority === 'critical').length,
    high: result.findings.filter(f => f.priority === 'high').length,
    medium: result.findings.filter(f => f.priority === 'medium').length,
    low: result.findings.filter(f => f.priority === 'low').length,
    info: result.findings.filter(f => f.priority === 'info').length,
  };

  console.log('\n' + chalk.cyan('─'.repeat(50)));
  console.log(chalk.white(`  PR Review: ${result.baseRef}...${result.headRef}`));
  console.log(chalk.cyan('─'.repeat(50)));
  console.log();
  console.log(chalk.gray('  Reviewers run:'), result.selectedReviewers.map(r => r.reviewerId).join(', '));
  console.log(chalk.gray('  Total findings:'), result.findings.length);
  if (result.rejectedFindings && result.rejectedFindings > 0) {
    console.log(chalk.gray('  Rejected (unverified):'), result.rejectedFindings);
  }
  console.log();

  if (counts.critical > 0) console.log(chalk.red(`  🔴 Critical: ${counts.critical}`));
  if (counts.high > 0) console.log(chalk.yellow(`  🟠 High:     ${counts.high}`));
  if (counts.medium > 0) console.log(chalk.white(`  🟡 Medium:   ${counts.medium}`));
  if (counts.low > 0) console.log(chalk.gray(`  🟢 Low:      ${counts.low}`));
  if (counts.info > 0) console.log(chalk.gray(`  ℹ️  Info:     ${counts.info}`));

  if (result.autoApproved) {
    console.log();
    console.log(chalk.green('  ✅ PR auto-approved (no findings above threshold)'));
  }

  console.log();
  const critical = result.findings.filter(f => f.priority === 'critical' || f.priority === 'high').slice(0, 5);
  for (const f of critical) {
    const icon = f.priority === 'critical' ? '🔴' : '🟠';
    console.log(`  ${icon} ${chalk.white(f.title)}`);
    console.log(chalk.gray(`     ${f.filePath}:${f.startLine} — ${f.recommendation.slice(0, 80)}`));
  }
  if (result.findings.length > 5) {
    console.log(chalk.gray(`  ... and ${result.findings.length - 5} more findings in the report`));
  }
  console.log();
}
