import { ToolRunResult } from './runner';

/**
 * Format tool output into a context string for the AI reviewer.
 * Wraps the raw output with instructions telling the AI how to interpret it.
 */
export function formatToolContext(toolName: string, result: ToolRunResult): string {
  const sections: string[] = [];

  sections.push(`## Static Analysis Tool Output: ${toolName}`);
  sections.push('');
  sections.push(`The following output was produced by running the "${toolName}" tool on the codebase.`);
  sections.push('Your job is to analyze these results alongside the source code and:');
  sections.push('1. Filter out false positives and noise (stylistic preferences, inapplicable rules, framework-specific false alarms)');
  sections.push('2. Prioritize findings by actual security, quality, or correctness impact');
  sections.push('3. Group related findings into coherent issues where appropriate');
  sections.push('4. Map each finding to a specific file path and line number from the tool output');
  sections.push('5. Add context about WHY each issue matters and provide actionable remediation');
  sections.push('6. Do NOT blindly repeat every tool finding - only report issues that represent real problems');
  sections.push('');

  if (result.stdout) {
    sections.push('```');
    sections.push(result.stdout);
    sections.push('```');
  } else {
    sections.push('*Tool produced no output (clean run or tool not applicable to this project).*');
  }

  if (result.truncated) {
    sections.push('');
    sections.push('*Note: Tool output was truncated due to size limits. Focus on the most impactful findings shown above.*');
  }

  if (result.stderr && result.stderr.length > 0 && result.stderr.length < 2000) {
    sections.push('');
    sections.push('Tool stderr:');
    sections.push('```');
    sections.push(result.stderr);
    sections.push('```');
  }

  return sections.join('\n');
}
