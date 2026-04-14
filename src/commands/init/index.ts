import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';
import { saveConfig } from '../../core/config/loader';
import {
  CONFIG_DIR,
  REVIEWERS_DIR,
  CONFIG_FILE,
  CONFIG_LOCAL_FILE,
  DEFAULT_MODEL,
  DEFAULT_API_KEY_ENV,
} from '../../core/config/defaults';

export async function runInit(repoPath: string): Promise<void> {
  console.log(chalk.cyan('\n🦇 BatEye Init\n'));

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

  const configPath = path.join(repoPath, CONFIG_FILE);
  if (!fs.existsSync(configPath)) {
    saveConfig(repoPath, {
      $schema: './node_modules/bateye/schemas/bateye-config.schema.json',
      model: DEFAULT_MODEL,
      exclude: [],
    });
    console.log(chalk.green('  created'), CONFIG_FILE);
  } else {
    console.log(chalk.gray('  exists '), CONFIG_FILE);
  }

  const gitignorePath = path.join(repoPath, '.gitignore');
  const ignoreEntries = ['.bateye/out/', CONFIG_LOCAL_FILE];
  const gitignoreExists = fs.existsSync(gitignorePath);
  const gitignoreContent = gitignoreExists ? fs.readFileSync(gitignorePath, 'utf-8') : '';
  const gitignoreLines = gitignoreContent.split(/\r?\n/);
  const missingEntries = ignoreEntries.filter(entry => !gitignoreLines.includes(entry));
  if (missingEntries.length > 0) {
    let nextContent = gitignoreContent;
    if (nextContent.length > 0 && !nextContent.endsWith('\n')) {
      nextContent += '\n';
    }
    if (nextContent.length > 0) {
      nextContent += '\n';
    }
    nextContent += `# BatEye\n${missingEntries.join('\n')}\n`;
    fs.writeFileSync(gitignorePath, nextContent, 'utf-8');
    console.log(chalk.green(gitignoreExists ? '  updated' : '  created'), '.gitignore');
  }

  console.log(chalk.cyan('\nNext steps:'));
  console.log(`  1. Set your API key:   export ${DEFAULT_API_KEY_ENV}=your_key`);
  console.log(`     Gateway example:   bateye config set transport vercel`);
  console.log(`  2. Run a check:        ${chalk.white('bateye doctor')}`);
  console.log(`  3. Run an audit:       ${chalk.white('bateye audit')}`);
  console.log();
}
