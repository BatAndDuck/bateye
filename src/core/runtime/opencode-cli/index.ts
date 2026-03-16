import execa from 'execa';
import { z } from 'zod';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { AgenticRepositoryReviewOptions, IRuntime, RunOptions, RunResult } from '../interface';
import {
  buildOpenCodeEnvironment,
  buildOpenCodeRunArguments,
  resolveOpenCodeInvocation,
} from './command';

function extractJson(rawText: string): string {
  const jsonMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)```/) ||
    rawText.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
  return jsonMatch ? jsonMatch[1].trim() : rawText.trim();
}

function normalizeOpenCodeError(err: unknown): Error {
  const candidate = err as {
    exitCode?: number;
    stdout?: string;
    stderr?: string;
    shortMessage?: string;
    message?: string;
    timedOut?: boolean;
  };
  const detail = [candidate.stderr, candidate.stdout]
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .join('\n')
    .trim();

  if (candidate.timedOut) {
    const suffix = detail ? ` Partial output: ${detail}` : '';
    return new Error(`OpenCode CLI timed out.${suffix}`);
  }

  if (/database is locked/i.test(detail)) {
    return new Error(
      'OpenCode CLI reported "database is locked". '
      + 'CodeOwl now serializes OpenCode runs within this process, but another OpenCode session may still be active. '
      + `Original output: ${detail}`
    );
  }

  if (detail) {
    return new Error(`OpenCode CLI failed${candidate.exitCode ? ` (exit code ${candidate.exitCode})` : ''}: ${detail}`);
  }

  return err instanceof Error ? err : new Error(candidate.shortMessage || candidate.message || String(err));
}

export class OpenCodeCLIRuntime implements IRuntime {
  async isAvailable(): Promise<boolean> {
    try {
      const invocation = resolveOpenCodeInvocation();
      await execa(invocation.command, [...invocation.args, '--version']);
      return true;
    } catch {
      return false;
    }
  }

  async run<T>(options: RunOptions, schema: z.ZodType<T, z.ZodTypeDef, unknown>): Promise<RunResult<T>> {
    return this.executePrompt(options, schema, options.cwd || process.cwd(), 120000);
  }

  async runAgenticReview<T>(options: AgenticRepositoryReviewOptions, schema: z.ZodType<T, z.ZodTypeDef, unknown>): Promise<RunResult<T>> {
    return this.executePrompt(options, schema, options.repoPath, options.timeoutMs || 150000);
  }

  private async executePrompt<T>(
    options: RunOptions,
    schema: z.ZodType<T, z.ZodTypeDef, unknown>,
    cwd: string,
    timeoutMs: number,
  ): Promise<RunResult<T>> {
    const start = Date.now();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codeowl-opencode-'));
    const promptFile = path.join(tmpDir, 'prompt.txt');
    const xdgDataHome = path.join(tmpDir, 'xdg-data');
    fs.mkdirSync(xdgDataHome, { recursive: true });
    const fullPrompt = `${options.systemPrompt}\n\n${options.userMessage}`;
    fs.writeFileSync(promptFile, fullPrompt, 'utf-8');

    try {
      const invocation = resolveOpenCodeInvocation();
      const result = await execa(
        invocation.command,
        buildOpenCodeRunArguments(invocation, options, fullPrompt, promptFile),
        {
          cwd,
          env: buildOpenCodeEnvironment(process.env, options, xdgDataHome),
          timeout: timeoutMs,
        },
      );

      const rawText = result.stdout;
      const jsonStr = extractJson(rawText);
      const parsed = JSON.parse(jsonStr);
      const validated = schema.parse(parsed);

      return {
        data: validated,
        model: options.model,
        runtime: 'cli',
        durationMs: Date.now() - start,
        rawResponse: rawText,
      };
    } catch (err) {
      throw normalizeOpenCodeError(err);
    } finally {
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch {
        // Best-effort temp cleanup; a lingering file handle should not fail the review.
      }
    }
  }

  async listModels(_provider: string, _apiKey: string, _apiBaseUrl?: string): Promise<string[]> {
    try {
      const invocation = resolveOpenCodeInvocation();
      const result = await execa(invocation.command, [...invocation.args, 'models', '--json']);
      const models = JSON.parse(result.stdout);
      return Array.isArray(models) ? models : [];
    } catch {
      return [];
    }
  }
}
