import * as path from 'path';
import chalk from 'chalk';
import { AuditResult } from '../../../types/index';
import { scoreToGrade, scoreToLabel } from '../../../core/scoring/normalizer';
import { formatTokenSummary } from '../../../core/runtime/token-utils';
import { runAudit } from '../application/audit-service';
import { runCliTask } from '../../shared/presentation/run-cli-task';

export interface AuditCommandOptions {
  output?: string;
  reviewers?: string;
}

export async function runAuditCommand(repoPath: string, options: AuditCommandOptions): Promise<void> {
  await runCliTask({
    title: '🦉 CodeOwl Audit',
    startText: 'Starting audit...',
    successText: 'Audit complete',
    errorPrefix: 'Audit failed',
    task: onProgress => runAudit({
      repoPath,
      outputPath: options.output,
      reviewerIds: options.reviewers ? options.reviewers.split(',').map(segment => segment.trim()) : undefined,
      onProgress,
    }),
    render: printAuditSummary,
  });
}

function printAuditSummary(result: AuditResult): void {
  const grade = scoreToGrade(result.overallScore);
  const label = scoreToLabel(result.overallScore);
  const reportPath = result.repoPath
    ? path.join(result.repoPath, '.codeowl', 'out', 'audit.json')
    : path.join('.codeowl', 'out', 'audit.json');

  console.log('\n' + chalk.cyan('─'.repeat(50)));
  console.log(chalk.white('  Overall Score: ') + chalk.bold(`${result.overallScore}/100`) + ` (${grade} - ${label})`);
  console.log(chalk.cyan('─'.repeat(50)));
  console.log();
  const statusColor = result.status === 'complete' ? chalk.green : chalk.yellow;
  console.log(chalk.gray('  Status: ') + statusColor(result.status.toUpperCase()));
  if (result.tokenUsage) {
    console.log(chalk.gray('  Token usage: ') + chalk.white(formatTokenSummary(result.tokenUsage)));
  }
  console.log();

  for (const reviewerResult of result.reviewerResults) {
    const icon = reviewerResult.score >= 80 ? '✓' : reviewerResult.score >= 60 ? '⚠' : '✗';
    const color = reviewerResult.score >= 80 ? chalk.green : reviewerResult.score >= 60 ? chalk.yellow : chalk.red;
    console.log(color(`  ${icon}  ${reviewerResult.reviewerName}`) + chalk.gray(` - score: ${reviewerResult.score}, findings: ${reviewerResult.findings.length}`));

    const critical = reviewerResult.findings.filter(finding => finding.priority === 'critical');
    const high = reviewerResult.findings.filter(finding => finding.priority === 'high');

    for (const finding of critical.slice(0, 3)) {
      console.log(chalk.red(`      🔴 ${finding.title}`) + chalk.gray(` (${finding.filePath}:${finding.startLine})`));
    }
    for (const finding of high.slice(0, 2)) {
      console.log(chalk.yellow(`      🟠 ${finding.title}`) + chalk.gray(` (${finding.filePath}:${finding.startLine})`));
    }
  }

  const allFindings = result.reviewerResults.flatMap(reviewerResult => reviewerResult.findings);
  const counts = {
    critical: allFindings.filter(finding => finding.priority === 'critical').length,
    high: allFindings.filter(finding => finding.priority === 'high').length,
    medium: allFindings.filter(finding => finding.priority === 'medium').length,
    low: allFindings.filter(finding => finding.priority === 'low').length,
  };

  console.log();
  console.log(chalk.gray('  Findings:') +
    (counts.critical ? chalk.red(` ${counts.critical} critical`) : '') +
    (counts.high ? chalk.yellow(` ${counts.high} high`) : '') +
    (counts.medium ? chalk.white(` ${counts.medium} medium`) : '') +
    (counts.low ? chalk.gray(` ${counts.low} low`) : ''));

  console.log();
  console.log(chalk.gray('  Summary: ') + chalk.white(result.summary));
  if (result.issues.length > 0) {
    console.log(chalk.yellow(`  Review issues (${result.issues.length}):`));
    for (const issue of result.issues.slice(0, 5)) {
      console.log(chalk.yellow(`    - ${issue.message}`));
    }
    if (result.issues.length > 5) {
      console.log(chalk.gray(`    ... and ${result.issues.length - 5} more`));
    }
  }
  console.log(chalk.gray('  Report:  ') + chalk.white(reportPath));
  console.log();
}
