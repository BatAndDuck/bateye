import execa from 'execa';
import { ReviewerToolConfig } from '../../types/index';
import { DEFAULT_TOOL_TIMEOUT_MS, DEFAULT_TOOL_MAX_OUTPUT_CHARS } from '../config/defaults';

export type ToolRunResult = {
  success: boolean;
  stdout: string;
  stderr: string;
  truncated: boolean;
  durationMs: number;
  error?: string;
};

/**
 * Execute a reviewer's scanning tool and capture its output.
 *
 * @param toolConfig  The tool configuration from reviewer frontmatter
 * @param repoPath    The repository root directory (used as cwd)
 * @param targetFiles Optional list of files to append to args (for file-targeted tools in PR mode)
 */
export async function runReviewerTool(
  toolConfig: ReviewerToolConfig,
  repoPath: string,
  targetFiles?: string[],
): Promise<ToolRunResult> {
  const timeout = toolConfig.timeout ?? DEFAULT_TOOL_TIMEOUT_MS;
  const maxOutputChars = toolConfig.maxOutputChars ?? DEFAULT_TOOL_MAX_OUTPUT_CHARS;

  // Build final args: start with configured args, optionally append target files
  let finalArgs = [...toolConfig.args];
  if (
    toolConfig.targeting === 'file' &&
    toolConfig.fileArgs &&
    targetFiles &&
    targetFiles.length > 0
  ) {
    finalArgs = finalArgs.concat(targetFiles);
  }

  const start = Date.now();

  try {
    const result = await execa(toolConfig.command, finalArgs, {
      cwd: repoPath,
      timeout,
      reject: false, // Don't throw on non-zero exit - lint tools exit non-zero when they find issues
      stripFinalNewline: true,
    });

    const durationMs = Date.now() - start;
    let stdout = result.stdout || '';
    let truncated = false;

    if (stdout.length > maxOutputChars) {
      stdout = stdout.slice(0, maxOutputChars) + `\n\n[...output truncated at ${maxOutputChars} characters...]`;
      truncated = true;
    }

    // A tool "succeeds" if it produced output, even with a non-zero exit code
    // (lint tools exit 1 when they find issues, which is expected)
    const hasOutput = stdout.length > 0;
    // exitCode undefined means the command was not found (ENOENT) or was killed - treat
    // as "tool not available" rather than a hard error so the reviewer still runs.
    const commandNotAvailable = result.exitCode === undefined || result.exitCode === null;
    const isRealError = !commandNotAvailable && result.exitCode !== 0 && result.exitCode !== 1 && !hasOutput;

    return {
      success: commandNotAvailable ? true : !isRealError,
      stdout: commandNotAvailable ? '' : stdout,
      stderr: result.stderr || '',
      truncated,
      durationMs,
      error: commandNotAvailable
        ? `Tool '${toolConfig.command}' not found - install it to enable this check`
        : isRealError ? `Exit code ${result.exitCode}: ${result.stderr || 'unknown error'}` : undefined,
    };
  } catch (err) {
    const durationMs = Date.now() - start;
    const message = err instanceof Error ? err.message : String(err);

    return {
      success: false,
      stdout: '',
      stderr: message,
      truncated: false,
      durationMs,
      error: message,
    };
  }
}
