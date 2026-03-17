import { TokenUsage } from './interface';

/** Add two TokenUsage objects together. If either is estimated, the result is estimated. */
export function addTokens(a: TokenUsage, b: TokenUsage): TokenUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    estimated: a.estimated || b.estimated,
  };
}

/** Format a TokenUsage for human-readable log output. */
export function formatTokenSummary(usage: TokenUsage): string {
  const total = usage.inputTokens + usage.outputTokens;
  const suffix = usage.estimated ? ' (est)' : ' (actual)';
  return `${total.toLocaleString()} tokens (${usage.inputTokens.toLocaleString()} in + ${usage.outputTokens.toLocaleString()} out)${suffix}`;
}
