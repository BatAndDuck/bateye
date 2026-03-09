import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';
import { saveConfig } from '../../core/config/loader';
import { CONFIG_DIR, REVIEWERS_DIR, CONFIG_FILE, DEFAULT_MODEL, DEFAULT_LIGHT_MODEL, DEFAULT_API_KEY_ENV } from '../../core/config/defaults';

export async function runInit(repoPath: string): Promise<void> {
  console.log(chalk.cyan('\n🦉 CodeOwl Init\n'));

  // Create .codeowl directory
  const configDir = path.join(repoPath, CONFIG_DIR);
  const reviewersDir = path.join(repoPath, REVIEWERS_DIR);
  const outDir = path.join(repoPath, CONFIG_DIR, 'out');

  [configDir, reviewersDir, outDir].forEach(d => {
    if (!fs.existsSync(d)) {
      fs.mkdirSync(d, { recursive: true });
      console.log(chalk.green('  created'), d.replace(repoPath + '/', ''));
    } else {
      console.log(chalk.gray('  exists '), d.replace(repoPath + '/', ''));
    }
  });

  // Create config if not exists
  const configPath = path.join(repoPath, CONFIG_FILE);
  if (!fs.existsSync(configPath)) {
    saveConfig(repoPath, {
      $schema: './node_modules/codeowl/schemas/codeowl-config.schema.json',
      model: DEFAULT_MODEL,
      lightModel: DEFAULT_LIGHT_MODEL,
      apiKeyEnv: DEFAULT_API_KEY_ENV,
      exclude: [],
    });
    console.log(chalk.green('  created'), CONFIG_FILE);
  } else {
    console.log(chalk.gray('  exists '), CONFIG_FILE);
  }

  // Add .codeowl/out to .gitignore
  const gitignorePath = path.join(repoPath, '.gitignore');
  const outEntry = '.codeowl/out/';
  if (fs.existsSync(gitignorePath)) {
    const content = fs.readFileSync(gitignorePath, 'utf-8');
    if (!content.includes(outEntry)) {
      fs.appendFileSync(gitignorePath, `\n# CodeOwl output\n${outEntry}\n`);
      console.log(chalk.green('  updated'), '.gitignore');
    }
  }

  console.log(chalk.cyan('\nNext steps:'));
  console.log(`  1. Set your API key:   export ANTHROPIC_API_KEY=your-key`);
  console.log(`  2. Run a check:        ${chalk.white('codeowl doctor')}`);
  console.log(`  3. Run an audit:       ${chalk.white('codeowl audit')}`);
  console.log();
}
