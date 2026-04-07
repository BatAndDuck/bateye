import chalk from 'chalk';
import ora from 'ora';
import { briefError, categorizeError, ISSUE_TRACKER_URL } from '../../../core/output/user-error';
import { formatErrorWithCauses } from '../../../core/runtime/error-format';
import { isRuntimeDebugEnabled } from '../../../core/runtime/debug';

export interface CliTaskOptions<TResult> {
  title: string;
  startText: string;
  successText: string;
  errorPrefix: string;
  task: (onProgress: (message: string) => void) => Promise<TResult>;
  render: (result: TResult) => void;
}

export async function runCliTask<TResult>(options: CliTaskOptions<TResult>): Promise<void> {
  console.log(chalk.cyan(`\n${options.title}\n`));
  const interactive = Boolean(process.stdout.isTTY && !process.env.CI);
  let lastMessage = options.startText;
  const noticePattern = /^\s*(Warning:|⚠|✗)/;

  if (!interactive) {
    console.log(chalk.gray(`- ${options.startText}`));
  }

  const spinner = interactive
    ? ora({ text: options.startText, color: 'cyan' }).start()
    : null;

  try {
    const result = await options.task(message => {
      if (noticePattern.test(message)) {
        if (spinner) {
          spinner.stopAndPersist({ symbol: chalk.yellow('!'), text: message.trim() });
          spinner.start(lastMessage);
        } else {
          console.log(chalk.yellow(`! ${message.trim()}`));
        }
        return;
      }

      lastMessage = message;
      if (spinner) {
        spinner.text = message;
      } else {
        console.log(chalk.gray(`- ${message}`));
      }
    });

    if (spinner) {
      spinner.succeed(chalk.green(options.successText));
    }
    options.render(result);
    if (!interactive) {
      console.log(chalk.green(`√ ${options.successText}`));
    }
  } catch (err) {
    const verbose = isRuntimeDebugEnabled();
    const fullMsg = formatErrorWithCauses(err instanceof Error ? err : new Error(String(err)));
    const displayMsg = verbose ? fullMsg : briefError(err);

    if (spinner) {
      spinner.fail(chalk.red(`${options.errorPrefix}: ${displayMsg}`));
    } else {
      console.error(chalk.red(`✖ ${options.errorPrefix}: ${displayMsg}`));
    }

    if (!verbose) {
      console.log(chalk.gray('  Run with --verbose for full diagnostic details.'));
    }

    // For unrecognised errors, point to the issue tracker
    const { category } = categorizeError(fullMsg);
    if (category === 'unknown') {
      console.log(chalk.gray(`  Report issues: ${ISSUE_TRACKER_URL}`));
    }

    process.exit(1);
  }
}
