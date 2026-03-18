import * as fs from 'fs';
import * as path from 'path';

/**
 * Writes an LLM call's system prompt and user message to files in the given directory.
 * Files are named with a timestamp and label so CI artifact uploads capture every call.
 * Failures are silently ignored so logging never breaks the pipeline.
 */
export function logPrompt(dir: string, label: string, systemPrompt: string, userMessage: string): void {
  try {
    fs.mkdirSync(dir, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const safeLabel = label.replace(/[^a-zA-Z0-9_-]/g, '_');
    fs.writeFileSync(path.join(dir, `${ts}-${safeLabel}-system.txt`), systemPrompt, 'utf-8');
    fs.writeFileSync(path.join(dir, `${ts}-${safeLabel}-user.txt`), userMessage, 'utf-8');
  } catch {
    // Logging failure must never break the pipeline
  }
}
