import { Command } from 'commander';
import * as path from 'path';
import { runInit } from '../commands/init/index';
import { runDoctor } from '../commands/doctor/index';
import { runModels } from '../commands/models/index';
import { runConfigShow, runConfigSet } from '../commands/config/index';
import { runAuditCommand } from '../commands/audit/index';
import { runPRReviewCommand } from '../commands/pr-review/index';
import { runSystemDesignCommand } from '../commands/system-design/index';
import { runReviewersList } from '../commands/reviewers/index';

export function createCLI(): Command {
  const program = new Command();

  program
    .name('codeowl')
    .description('AI-powered code analysis CLI')
    .version('0.1.0');

  // Shared option helper
  const getRepoPath = (cmd: Command): string => {
    const opts = cmd.optsWithGlobals();
    return path.resolve(opts.cwd || process.cwd());
  };

  program
    .option('--cwd <path>', 'Working directory (defaults to current directory)')
    .option('--verbose', 'Enable verbose runtime diagnostics');

  program.hook('preAction', command => {
    const opts = command.optsWithGlobals();
    if (opts.verbose) {
      process.env.CODEOWL_VERBOSE = '1';
    }
  });

  // ── init ──────────────────────────────────────────────────────────────
  program
    .command('init')
    .description('Initialize CodeOwl in the current repository')
    .action(async (_, cmd) => {
      await runInit(getRepoPath(cmd));
    });

  // ── doctor ───────────────────────────────────────────────────────────
  program
    .command('doctor')
    .description('Check CodeOwl setup and configuration')
    .action(async (_, cmd) => {
      await runDoctor(getRepoPath(cmd));
    });

  // ── models ────────────────────────────────────────────────────────────
  program
    .command('models [provider]')
    .description('List available AI models (optionally filter by provider, e.g. groq, anthropic, openai)')
    .action(async (provider, _, cmd) => {
      await runModels(getRepoPath(cmd), provider);
    });

  // ── config ────────────────────────────────────────────────────────────
  const configCmd = program
    .command('config')
    .description('Manage CodeOwl configuration');

  configCmd
    .command('show')
    .description('Show current configuration')
    .action(async (_, cmd) => {
      await runConfigShow(getRepoPath(cmd.parent!.parent!));
    });

  configCmd
    .command('set <field> <value>')
    .description('Set a configuration field (model, transport, apiBaseUrl, exclude)')
    .action(async (field: string, value: string, _, cmd) => {
      await runConfigSet(getRepoPath(cmd.parent!.parent!), field, value);
    });

  // ── reviewers ──────────────────────────────────────────────────────────
  program
    .command('reviewers')
    .description('List available reviewers')
    .action(async (_, cmd) => {
      await runReviewersList(getRepoPath(cmd));
    });

  // ── audit ─────────────────────────────────────────────────────────────
  program
    .command('audit')
    .description('Run a full codebase audit')
    .option('-o, --output <path>', 'Output path for audit JSON report')
    .option('-r, --reviewers <ids>', 'Comma-separated reviewer IDs to run (default: all)')
    .action(async (opts, cmd) => {
      await runAuditCommand(getRepoPath(cmd), opts);
    });

  // ── pr-review ─────────────────────────────────────────────────────────
  program
    .command('pr-review')
    .description('Review a pull request')
    .option('--base <ref>', 'Base branch/ref (default: origin/main)')
    .option('--head <ref>', 'Head branch/ref (default: HEAD)')
    .option('--github', 'Post comments to GitHub')
    .option('--token <token>', 'GitHub token (or set GITHUB_TOKEN env var)')
    .option('--pr-number <number>', 'GitHub PR number (required for --github outside of CI)')
    .option('--dry-run', 'Run analysis but do not post GitHub comments')
    .action(async (opts, cmd) => {
      await runPRReviewCommand(getRepoPath(cmd), {
        base: opts.base,
        head: opts.head,
        github: opts.github,
        token: opts.token,
        prNumber: opts.prNumber,
        dryRun: opts.dryRun,
      });
    });

  // ── system-design ─────────────────────────────────────────────────────
  program
    .command('system-design')
    .description('Generate system design documentation and interactive visualization')
    .option('-o, --output <dir>', 'Output directory for report')
    .action(async (opts, cmd) => {
      await runSystemDesignCommand(getRepoPath(cmd), { output: opts.output });
    });

  program.configureOutput({
    writeErr: str => process.stderr.write(str),
  });

  return program;
}

