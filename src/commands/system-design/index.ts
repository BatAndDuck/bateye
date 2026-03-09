import chalk from 'chalk';
import ora from 'ora';
import * as path from 'path';
import { runSystemDesign } from '../../core/system-design/runner';
import { SystemDesignResult } from '../../types/index';
import { scoreToLabel } from '../../core/scoring/normalizer';

export interface SystemDesignCommandOptions {
  output?: string;
}

export async function runSystemDesignCommand(repoPath: string, options: SystemDesignCommandOptions): Promise<void> {
  console.log(chalk.cyan('\n🦉 CodeOwl System Design\n'));

  const spinner = ora({ text: 'Starting system design analysis...', color: 'cyan' }).start();

  let result: SystemDesignResult;
  try {
    result = await runSystemDesign({
      repoPath,
      outputDir: options.output,
      onProgress: msg => { spinner.text = msg; },
    });
  } catch (err) {
    spinner.fail(chalk.red(`System design failed: ${(err as Error).message}`));
    process.exit(1);
  }

  spinner.succeed(chalk.green('System design complete'));
  printSystemDesignSummary(result);
}

function printSystemDesignSummary(result: SystemDesignResult): void {
  const label = scoreToLabel(result.score);

  console.log('\n' + chalk.cyan('─'.repeat(50)));
  console.log(chalk.white('  Architecture:'), chalk.bold(result.architectureType.replace(/-/g, ' ')));
  console.log(chalk.white('  Score:       '), chalk.bold(`${result.score}/100`) + chalk.gray(` (${label})`));
  console.log(chalk.cyan('─'.repeat(50)));
  console.log();

  console.log(chalk.white('  Services detected:'), result.services.length);
  for (const s of result.services) {
    console.log(chalk.gray(`    • ${s.name}`) + chalk.cyan(` [${s.kind}]`) + chalk.gray(` — ${s.purpose.slice(0, 60)}`));
  }

  console.log();
  if (result.strengths.length > 0) {
    console.log(chalk.green('  Strengths:'));
    for (const s of result.strengths.slice(0, 3)) {
      console.log(chalk.gray(`    ✓ ${s}`));
    }
  }

  if (result.weaknesses.length > 0) {
    console.log(chalk.yellow('  Weaknesses:'));
    for (const w of result.weaknesses.slice(0, 3)) {
      console.log(chalk.gray(`    ⚠ ${w}`));
    }
  }

  console.log();
  console.log(chalk.white('  Artifacts:'));
  console.log(chalk.gray('    📄 HTML report: ') + chalk.cyan(result.artifacts.htmlReportPath));
  console.log(chalk.gray('    📊 Graph data:  ') + chalk.cyan(result.artifacts.graphDataPath));
  console.log(chalk.gray('    📁 Services:    ') + chalk.cyan(result.artifacts.servicesDir));
  console.log();
  console.log(chalk.cyan('  Open the report: ') + chalk.white(`open ${result.artifacts.htmlReportPath}`));
  console.log();
}
