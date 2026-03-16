import execa from 'execa';
import { z } from 'zod';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { AgenticRepositoryReviewOptions, IRuntime, RunOptions, RunResult } from '../interface';

function extractJson(rawText: string): string {
  const jsonMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)```/) ||
    rawText.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
  return jsonMatch ? jsonMatch[1].trim() : rawText.trim();
}

export class OpenCodeCLIRuntime implements IRuntime {
  async isAvailable(): Promise<boolean> {
    try {
      await execa('opencode', ['--version']);
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
    const tmpDir = os.tmpdir();
    const promptFile = path.join(tmpDir, `codeowl-prompt-${Date.now()}.txt`);
    const fullPrompt = `${options.systemPrompt}\n\n${options.userMessage}`;
    fs.writeFileSync(promptFile, fullPrompt, 'utf-8');

    try {
      const result = await execa('opencode', ['run', '--no-interactive', promptFile], {
        cwd,
        env: { ...process.env },
        timeout: timeoutMs,
      });

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
    } finally {
      try { fs.unlinkSync(promptFile); } catch (err) { console.debug(`Cleanup failed for ${promptFile}: ${err}`); }
    }
  }

  async listModels(_provider: string, _apiKey: string, _apiBaseUrl?: string): Promise<string[]> {
    try {
      const result = await execa('opencode', ['models', '--json']);
      const models = JSON.parse(result.stdout);
      return Array.isArray(models) ? models : [];
    } catch {
      return [];
    }
  }
}
