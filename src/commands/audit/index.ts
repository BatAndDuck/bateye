import chalk from 'chalk';
import ora from 'ora';
import { runAudit } from '../../core/audit/runner';
import { scoreToGrade, scoreToLabel } from '../../core/scoring/normalizer';
import { AuditResult } from '../../types/index';

export interface AuditCommandOptions {
  output?: string;
  reviewers?: string;
}

export async function runAuditCommand(repoPath: string, options: AuditCommandOptions): Promise<void> {
  console.log(chalk.cyan('\n🦉 CodeOwl Audit\n'));

  const spinner = ora({ text: 'Starting audit...', color: 'cyan' }).start();

  let result: AuditResult;
  try {
    result = await runAudit({
      repoPath,
      outputPath: options.output,
      reviewerIds: options.reviewers ? options.reviewers.split(',').map(s => s.trim()) : undefined,
      onProgress: msg => {
        spinner.text = msg;
      },
    });
  } catch (err) {
    spinner.fail(chalk.red(`Audit failed: ${(err as Error).message}`));
    process.exit(1);
  }

  spinner.succeed(chalk.green('Audit complete'));
  printAuditSummary(result);
}

function printAuditSummary(result: AuditResult): void {
  const grade = scoreToGrade(result.overallScore);
  const label = scoreToLabel(result.overallScore);

  console.log('\n' + chalk.cyan('─'.repeat(50)));
  console.log(chalk.white(`  Overall Score: `) + chalk.bold(`${result.overallScore}/100`) + ` (${grade} — ${label})`);
  console.log(chalk.cyan('─'.repeat(50)));
  console.log();

  for (const rr of result.reviewerResults) {
    const icon = rr.score >= 80 ? '✓' : rr.score >= 60 ? '⚠' : '✗';
    const color = rr.score >= 80 ? chalk.green : rr.score >= 60 ? chalk.yellow : chalk.red;
    console.log(color(`  ${icon}  ${rr.reviewerName}`) + chalk.gray(` — score: ${rr.score}, findings: ${rr.findings.length}`));

    const critical = rr.findings.filter(f => f.priority === 'critical');
    const high = rr.findings.filter(f => f.priority === 'high');

    if (critical.length > 0) {
      for (const f of critical.slice(0, 3)) {
        console.log(chalk.red(`      🔴 ${f.title}`) + chalk.gray(` (${f.filePath}:${f.startLine})`));
      }
    }
    if (high.length > 0) {
      for (const f of high.slice(0, 2)) {
        console.log(chalk.yellow(`      🟠 ${f.title}`) + chalk.gray(` (${f.filePath}:${f.startLine})`));
      }
    }
  }

  const allFindings = result.reviewerResults.flatMap(r => r.findings);
  const counts = {
    critical: allFindings.filter(f => f.priority === 'critical').length,
    high: allFindings.filter(f => f.priority === 'high').length,
    medium: allFindings.filter(f => f.priority === 'medium').length,
    low: allFindings.filter(f => f.priority === 'low').length,
  };

  console.log();
  console.log(chalk.gray('  Findings:') +
    (counts.critical ? chalk.red(` ${counts.critical} critical`) : '') +
    (counts.high ? chalk.yellow(` ${counts.high} high`) : '') +
    (counts.medium ? chalk.white(` ${counts.medium} medium`) : '') +
    (counts.low ? chalk.gray(` ${counts.low} low`) : ''));

  console.log();
  console.log(chalk.gray('  Report: ') + chalk.white(result.reviewerResults[0]?.execution ? '  ✓ written' : ''));
  console.log();
}
