import execa from 'execa';
import { z } from 'zod';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { IRuntime, RunOptions, RunResult } from '../interface';

export class OpenCodeCLIRuntime implements IRuntime {
  async isAvailable(): Promise<boolean> {
    try {
      await execa('opencode', ['--version']);
      return true;
    } catch {
      return false;
    }
  }

  async run<T>(options: RunOptions, schema: z.ZodSchema<T>): Promise<RunResult<T>> {
    const start = Date.now();
    // Write prompt to temp file
    const tmpDir = os.tmpdir();
    const promptFile = path.join(tmpDir, `codeowl-prompt-${Date.now()}.txt`);
    const fullPrompt = `${options.systemPrompt}\n\n${options.userMessage}`;
    fs.writeFileSync(promptFile, fullPrompt, 'utf-8');

    try {
      const result = await execa('opencode', ['run', '--no-interactive', promptFile], {
        env: { ...process.env },
        timeout: 120000,
      });

      const rawText = result.stdout;
      // Try to parse JSON from output
      const jsonMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)```/) ||
        rawText.match(/(\{[\s\S]*\})/);
      const jsonStr = jsonMatch ? jsonMatch[1].trim() : rawText.trim();
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
      try { fs.unlinkSync(promptFile); } catch { /* cleanup best-effort */ }
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
