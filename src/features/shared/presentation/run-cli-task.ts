import chalk from 'chalk';
import ora from 'ora';

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

  if (!interactive) {
    console.log(chalk.gray(`- ${options.startText}`));
  }

  const spinner = interactive
    ? ora({ text: options.startText, color: 'cyan' }).start()
    : null;

  try {
    const result = await options.task(message => {
      lastMessage = message;
      if (spinner) {
        spinner.text = message;
      }
    });

    if (spinner) {
      spinner.succeed(chalk.green(options.successText));
    }
    options.render(result);
    if (!interactive) {
      console.log(chalk.gray(`- ${lastMessage}`));
      console.log(chalk.green(`√ ${options.successText}`));
    }
  } catch (err) {
    if (spinner) {
      spinner.fail(chalk.red(`${options.errorPrefix}: ${(err as Error).message}`));
    } else {
      console.error(chalk.red(`${options.errorPrefix}: ${(err as Error).message}`));
    }
    process.exit(1);
  }
}
