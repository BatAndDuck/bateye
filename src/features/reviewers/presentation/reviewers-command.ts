import chalk from 'chalk';
import { loadReviewers } from '../application/reviewer-registry';

export async function runReviewersList(repoPath: string): Promise<void> {
  console.log(chalk.cyan('\n🦇 BatEye Reviewers\n'));

  const { reviewers, warnings } = loadReviewers(repoPath);

  for (const warning of warnings) {
    console.log(chalk.yellow('  ⚠'), warning);
  }

  if (reviewers.length === 0) {
    console.log(chalk.gray('  No reviewers found. Add custom reviewers to .bateye/reviewers/*.md.'));
    return;
  }

  const builtIn = reviewers.filter(reviewer => reviewer.isBuiltIn);
  const user = reviewers.filter(reviewer => !reviewer.isBuiltIn);

  if (builtIn.length > 0) {
    console.log(chalk.white('  Built-in reviewers:'));
    for (const reviewer of builtIn) {
      console.log(`    ${chalk.cyan(reviewer.id.padEnd(20))} ${chalk.gray(reviewer.name)}`);
      if (reviewer.description) {
        console.log(chalk.gray(`    ${''.padEnd(20)} ${reviewer.description}`));
      }
    }
    console.log();
  }

  if (user.length > 0) {
    console.log(chalk.white('  User reviewers (.bateye/reviewers/):'));
    for (const reviewer of user) {
      console.log(`    ${chalk.cyan(reviewer.id.padEnd(20))} ${chalk.gray(reviewer.name)}`);
      if (reviewer.description) {
        console.log(chalk.gray(`    ${''.padEnd(20)} ${reviewer.description}`));
      }
    }
    console.log();
  }

  console.log(chalk.gray(`  Total: ${reviewers.length} reviewer(s)`));
  console.log(chalk.gray('  Built-in reviewers live in src/features/audit/builtin-reviewers/'));
  console.log();
}
