import chalk from 'chalk';
import * as path from 'path';
import { loadReviewers } from '../../core/reviewers/loader';

export async function runReviewersList(repoPath: string): Promise<void> {
  console.log(chalk.cyan('\n🦉 CodeOwl Reviewers\n'));

  const { reviewers, warnings } = loadReviewers(repoPath);

  for (const w of warnings) {
    console.log(chalk.yellow('  ⚠'), w);
  }

  if (reviewers.length === 0) {
    console.log(chalk.gray('  No reviewers found. Run `codeowl init` to set up.'));
    return;
  }

  const builtIn = reviewers.filter(r => r.isBuiltIn);
  const user = reviewers.filter(r => !r.isBuiltIn);

  if (builtIn.length > 0) {
    console.log(chalk.white('  Built-in reviewers:'));
    for (const r of builtIn) {
      console.log(`    ${chalk.cyan(r.id.padEnd(20))} ${chalk.gray(r.name)}`);
      if (r.description) console.log(chalk.gray(`    ${''.padEnd(20)} ${r.description}`));
    }
    console.log();
  }

  if (user.length > 0) {
    console.log(chalk.white('  User reviewers (.codeowl/reviewers/):'));
    for (const r of user) {
      console.log(`    ${chalk.cyan(r.id.padEnd(20))} ${chalk.gray(r.name)}`);
      if (r.description) console.log(chalk.gray(`    ${''.padEnd(20)} ${r.description}`));
    }
    console.log();
  }

  console.log(chalk.gray(`  Total: ${reviewers.length} reviewer(s)`));
  console.log(chalk.gray(`  Add custom reviewers to .codeowl/reviewers/*.md`));
  console.log();
}
