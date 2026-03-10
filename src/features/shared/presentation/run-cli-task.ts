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

  const spinner = ora({ text: options.startText, color: 'cyan' }).start();

  try {
    const result = await options.task(message => {
      spinner.text = message;
    });

    spinner.succeed(chalk.green(options.successText));
    options.render(result);
  } catch (err) {
    spinner.fail(chalk.red(`${options.errorPrefix}: ${(err as Error).message}`));
    process.exit(1);
  }
}
