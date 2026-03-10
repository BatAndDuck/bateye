import chalk from 'chalk';
import { scoreToLabel } from '../../../core/scoring/normalizer';
import { SystemDesignResult } from '../../../types/index';
import { runCliTask } from '../../shared/presentation/run-cli-task';
import { runSystemDesign } from '../application/system-design-service';

export interface SystemDesignCommandOptions {
  output?: string;
}

export async function runSystemDesignCommand(repoPath: string, options: SystemDesignCommandOptions): Promise<void> {
  await runCliTask({
    title: '🦉 CodeOwl System Design',
    startText: 'Starting system design analysis...',
    successText: 'System design complete',
    errorPrefix: 'System design failed',
    task: onProgress => runSystemDesign({
      repoPath,
      outputDir: options.output,
      onProgress,
    }),
    render: printSystemDesignSummary,
  });
}

function printSystemDesignSummary(result: SystemDesignResult): void {
  const label = scoreToLabel(result.score);

  console.log('\n' + chalk.cyan('─'.repeat(50)));
  console.log(chalk.white('  Architecture:'), chalk.bold(result.architectureType.replace(/-/g, ' ')));
  console.log(chalk.white('  Score:       '), chalk.bold(`${result.score}/100`) + chalk.gray(` (${label})`));
  console.log(chalk.cyan('─'.repeat(50)));
  console.log();

  console.log(chalk.white('  Services detected:'), result.services.length);
  for (const service of result.services) {
    console.log(chalk.gray(`    • ${service.name}`) + chalk.cyan(` [${service.kind}]`) + chalk.gray(` - ${service.purpose.slice(0, 60)}`));
  }

  console.log();
  if (result.strengths.length > 0) {
    console.log(chalk.green('  Strengths:'));
    for (const strength of result.strengths.slice(0, 3)) {
      console.log(chalk.gray(`    ✓ ${strength}`));
    }
  }

  if (result.weaknesses.length > 0) {
    console.log(chalk.yellow('  Weaknesses:'));
    for (const weakness of result.weaknesses.slice(0, 3)) {
      console.log(chalk.gray(`    ⚠ ${weakness}`));
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
