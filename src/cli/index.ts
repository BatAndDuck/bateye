import { Command } from 'commander';
import * as path from 'path';
import packageJson from '../../package.json';
import { runInit } from '../commands/init/index';
import { runDoctor } from '../commands/doctor/index';
import { runModels } from '../commands/models/index';
import { runConf, runConfigShow, runConfigSet } from '../commands/config/index';
import { runAuditCommand } from '../commands/audit/index';
import { runPRReviewCommand } from '../commands/pr-review/index';
import { runReviewersList } from '../commands/reviewers/index';

function resolveCLIVersion(): string {
  try {
    return packageJson.version || '0.1.4';
  } catch {
    return '0.1.4';
  }
}

/** Build the top-level BatEye CLI program and register every supported command. */
export function createCLI(): Command {
  const program = new Command();

  program
    .name('bateye')
    .description('AI-powered code analysis CLI')
    .version(resolveCLIVersion());

  // Shared option helper
  const getRepoPath = (cmd: Command): string => {
    const opts = cmd.optsWithGlobals();
    return path.resolve(opts.cwd || process.cwd());
  };

  program
    .option('--cwd <path>', 'Working directory (defaults to current directory)')
    .option('--verbose', 'Enable verbose runtime diagnostics')
    .option('--diagnostic [dir]', 'Capture detailed diagnostics and prompt logs (optionally to a custom directory)');

  program.hook('preAction', command => {
    const opts = command.optsWithGlobals();
    const repoPath = path.resolve(opts.cwd || process.cwd());
    if (opts.verbose) {
      process.env.BATEYE_VERBOSE = '1';
    }
    if (opts.diagnostic !== undefined) {
      process.env.BATEYE_VERBOSE = '1';
      process.env.BATEYE_DIAGNOSTIC = '1';
      process.env.BATEYE_DIAGNOSTIC_DIR = typeof opts.diagnostic === 'string' && opts.diagnostic.trim()
        ? path.resolve(repoPath, opts.diagnostic)
        : path.join(repoPath, '.bateye', 'out', 'diagnostics');
    }
  });

  // ── init ──────────────────────────────────────────────────────────────
  program
    .command('init')
    .description('Initialize BatEye in the current repository')
    .action(async (_, cmd) => {
      await runInit(getRepoPath(cmd));
    });

  // ── doctor ───────────────────────────────────────────────────────────
  program
    .command('doctor')
    .description('Check BatEye setup and configuration')
    .action(async (_, cmd) => {
      await runDoctor(getRepoPath(cmd));
    });

  // ── models ────────────────────────────────────────────────────────────
  program
    .command('models [provider]')
    .description('List available AI models (optionally filter by provider, e.g. groq, anthropic, openai)')
    .option('-a, --all', 'List models from all supported providers (slow)')
    .action(async (provider, opts, cmd) => {
      await runModels(getRepoPath(cmd), provider, opts.all);
    });

  // ── config ────────────────────────────────────────────────────────────
  const configCmd = program
    .command('config')
    .description('Manage BatEye configuration');

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

  program
    .command('conf')
    .description('Quickly set the active model and repository API key')
    .option('--apikey <key>', 'Store the API key for the current repository')
    .option('--model <model>', 'Set the active model, e.g. openai/gpt-5.4-nano')
    .action(async (opts, cmd) => {
      await runConf(getRepoPath(cmd), {
        apiKey: opts.apikey,
        model: opts.model,
      });
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

  program.configureOutput({
    writeErr: str => process.stderr.write(str),
  });

  return program;
}

