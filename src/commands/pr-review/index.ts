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

function parsePrNumber(prNumber?: string): number | undefined {
  if (!prNumber) {
    return undefined;
  }

  const parsed = Number.parseInt(prNumber, 10);
  if (!Number.isInteger(parsed) || parsed <= 0 || String(parsed) !== prNumber.trim()) {
    throw new Error(`Invalid PR number: "${prNumber}". Expected a positive integer.`);
  }

  return parsed;
}

export async function runPRReviewCommand(repoPath: string, options: PRReviewCommandOptions): Promise<void> {
  console.log(chalk.cyan('\n🦉 BatEye PR Review\n'));

  const interactive = Boolean(process.stdout.isTTY && !process.env.CI);
  const spinner = interactive ? ora({ text: 'Starting PR review...', color: 'cyan' }).start() : null;
  let lastMessage = 'Starting PR review...';
  const noticePattern = /^\s*(Warning:|⚠|✗)/;

  if (!interactive) {
    console.log(chalk.gray(`- ${lastMessage}`));
  }

  let result: PRReviewResult;
  try {
    result = await runPRReview({
      repoPath,
      baseRef: options.base,
      headRef: options.head,
      github: options.github,
      githubToken: options.token,
      prNumber: parsePrNumber(options.prNumber),
      dryRun: options.dryRun,
      onProgress: msg => {
        if (noticePattern.test(msg)) {
          if (spinner) {
            spinner.stopAndPersist({ symbol: chalk.yellow('!'), text: msg.trim() });
            spinner.start(lastMessage);
          } else {
            console.log(chalk.yellow(`! ${msg.trim()}`));
          }
          return;
        }

        lastMessage = msg;
        if (spinner) {
          spinner.text = msg;
        } else {
          console.log(chalk.gray(`- ${msg}`));
        }
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.stack || err.message : String(err);
    if (spinner) {
      spinner.fail(chalk.red(`PR review failed: ${message}`));
    } else {
      console.error(chalk.red(`PR review failed: ${message}`));
    }
    process.exit(1);
  }

  if (spinner) {
    spinner.succeed(chalk.green('PR review complete'));
  } else {
    console.log(chalk.green('√ PR review complete'));
  }
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
  const statusColor = result.status === 'complete' ? chalk.green : chalk.yellow;
  console.log(chalk.gray('  Status:'), statusColor(result.status.toUpperCase()));
  console.log(chalk.gray('  Reviewers run:'), result.selectedReviewers.map(r => r.reviewerId).join(', '));
  if (result.verificationStats) {
    console.log(chalk.gray('  Raw findings:'), result.verificationStats.rawFindings);
    console.log(chalk.gray('  Rejected (deterministic):'), result.verificationStats.deterministicRejected);
    console.log(chalk.gray('  Rejected (semantic):'), result.verificationStats.semanticRejected);
    console.log(chalk.gray('  Final findings:'), result.verificationStats.finalFindings);
  } else {
    console.log(chalk.gray('  Total findings:'), result.findings.length);
    if (result.rejectedFindings && result.rejectedFindings > 0) {
      console.log(chalk.gray('  Rejected (unverified):'), result.rejectedFindings);
    }
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

  if (result.issues.length > 0) {
    console.log();
    console.log(chalk.yellow(`  Review issues (${result.issues.length}):`));
    for (const issue of result.issues.slice(0, 5)) {
      console.log(chalk.yellow(`    - ${issue.message}`));
    }
    if (result.issues.length > 5) {
      console.log(chalk.gray(`    ... and ${result.issues.length - 5} more`));
    }
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
