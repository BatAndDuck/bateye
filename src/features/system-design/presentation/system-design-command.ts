import chalk from 'chalk';
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
  console.log('\n' + chalk.cyan('─'.repeat(50)));
  console.log(chalk.white('  Architecture:'), chalk.bold(result.architectureType.replace(/-/g, ' ')));
  console.log(chalk.cyan('─'.repeat(50)));
  console.log();

  console.log(chalk.white('  Services detected:'), result.services.length);
  console.log(chalk.white('  Coverage confidence:'), chalk.bold(`${Math.round(result.coverage.overallConfidence * 100)}%`));
  if (result.coverage.gaps.length > 0) {
    console.log(chalk.white('  Coverage gaps:'), chalk.yellow(result.coverage.gaps.length));
  }
  for (const service of result.services) {
    console.log(
      chalk.gray(`    • ${service.name}`)
      + chalk.cyan(` [${service.kind}]`)
      + chalk.gray(` (${Math.round(service.confidence * 100)}%) - ${service.purpose.slice(0, 60)}`),
    );
  }

  console.log();
  console.log(chalk.white('  Artifacts:'));
  console.log(chalk.gray('    📄 HTML report: ') + chalk.cyan(result.artifacts.htmlReportPath));
  console.log(chalk.gray('    📊 Graph data:  ') + chalk.cyan(result.artifacts.graphDataPath));
  console.log(chalk.gray('    🧭 Inventory:   ') + chalk.cyan(result.artifacts.inventoryPath));
  console.log(chalk.gray('    🧪 Coverage:    ') + chalk.cyan(result.artifacts.coveragePath));
  console.log(chalk.gray('    🏗 Architecture: ') + chalk.cyan(result.artifacts.architecturePath));
  console.log(chalk.gray('    📁 Services:    ') + chalk.cyan(result.artifacts.servicesDir));
  console.log(chalk.gray('    📁 Units:       ') + chalk.cyan(result.artifacts.unitsDir));
  console.log();
  console.log(chalk.cyan('  Open the report: ') + chalk.white(`open ${result.artifacts.htmlReportPath}`));
  console.log();
}
