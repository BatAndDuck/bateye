import { formatErrorWithCauses } from '../runtime/error-format';
import { isRuntimeDebugEnabled } from '../runtime/debug';

export const ISSUE_TRACKER_URL = 'https://github.com/BatAndDuck/bateye/issues';

export type ErrorCategory =
  | 'auth'        // API key / authentication failure
  | 'model'       // Model not found or unsupported
  | 'timeout'     // Request timed out
  | 'network'     // Connection / DNS failure
  | 'rate-limit'  // Provider quota or rate limit
  | 'compat'      // Structured output or response format not supported
  | 'unknown';    // Unrecognised — show report link

export interface ErrorDiagnosis {
  category: ErrorCategory;
  /** One-line summary, suitable for inline progress/warning messages. */
  brief: string;
  /** Optional actionable next step. */
  hint?: string;
}

/**
 * Maps a raw error message string to a user-friendly diagnosis.
 * Works on the full error chain string (output of formatErrorWithCauses).
 */
export function categorizeError(msg: string): ErrorDiagnosis {
  if (
    /key not allowed|unauthorized|forbidden|invalid.*api.?key|api.?key.*invalid|incorrect.*api.*key|authentication failed|unauthenticated|invalid_api_key/i.test(msg)
  ) {
    return {
      category: 'auth',
      brief: 'API key rejected by provider.',
      hint: 'Run `bateye doctor` to check your credentials.',
    };
  }

  if (
    /model.*not.*found|no such model|model.*does not exist|invalid.*model.*id|unknown.*model|model.*unavailable|model.*not.*supported/i.test(msg)
  ) {
    return {
      category: 'model',
      brief: 'Model not found or not available.',
      hint: 'Run `bateye models` to see models available for this provider.',
    };
  }

  if (/timed? ?out after|request.*timed? ?out|connection.*timed? ?out/i.test(msg)) {
    return {
      category: 'timeout',
      brief: 'Request timed out.',
      hint: 'Try a faster model or a smaller reviewer set (--reviewers).',
    };
  }

  if (
    /econnrefused|connection refused|failed to connect|getaddrinfo.*failed|enotfound|network.*(?:error|fail)|socket.*hang.*up/i.test(msg)
  ) {
    return {
      category: 'network',
      brief: 'Network error — could not reach the provider.',
      hint: 'Check your internet connection and `apiBaseUrl` setting.',
    };
  }

  if (/rate.?limit|too many requests|quota.*exceeded|429/i.test(msg)) {
    return {
      category: 'rate-limit',
      brief: 'Rate limit or quota exceeded.',
      hint: 'Wait a moment and retry, or switch to a different model.',
    };
  }

  if (
    /invalid response structure|structured output|json.?schema.*not|empty response|provider.*not.*support|unexpected.*response/i.test(msg)
  ) {
    return {
      category: 'compat',
      brief: 'Provider returned an unexpected response (structured output may not be supported).',
      hint: 'Try a different model, or check your gateway / LiteLLM configuration.',
    };
  }

  // Fallback: take the first meaningful segment of the chain
  const firstSegment = msg.split(/\n| <- /)[0].trim();
  const brief = firstSegment.length > 160
    ? firstSegment.slice(0, 157) + '...'
    : firstSegment || 'Unknown error.';
  return { category: 'unknown', brief };
}

/**
 * Returns a one-line error summary for use inside progress / warning messages.
 *
 * - Normal mode: brief categorized description + optional hint.
 * - Verbose mode (--verbose): full error chain.
 */
export function briefError(err: unknown): string {
  const full = formatErrorWithCauses(err instanceof Error ? err : new Error(String(err)));
  if (isRuntimeDebugEnabled()) return full;

  const { brief, hint, category } = categorizeError(full);
  const hintSuffix = hint ? ` — ${hint}` : '';
  const verboseSuffix = !hint ? ' (run with --verbose for details)' : '';
  return brief + hintSuffix + (category === 'unknown' ? verboseSuffix : '');
}

/**
 * Returns the "run with --verbose" reminder string, or empty string if already verbose.
 * Useful for appending to console output after fatal errors.
 */
export function verboseReminder(): string {
  return isRuntimeDebugEnabled() ? '' : 'Run with --verbose for full diagnostic details.';
}
