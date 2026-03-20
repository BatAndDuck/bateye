export const BUILT_IN_EXCLUDES = [
  'node_modules',
  'dist',
  'build',
  'coverage',
  '.codeowl',
  '.claude',
  '.next',
  '.out',
  '.cache',
  'tmp',
  'temp',
  '.git',
];

export const CONFIG_DIR = '.codeowl';
export const CONFIG_FILE = '.codeowl/config.json';
export const REVIEWERS_DIR = '.codeowl/reviewers';
export const OUTPUT_DIR = '.codeowl/out';
export const AUDIT_OUTPUT_FILE = '.codeowl/out/audit.json';
export const PR_REVIEW_OUTPUT_FILE = '.codeowl/out/pr-review.json';
export const SYSTEM_DESIGN_OUTPUT_DIR = '.codeowl/out/system-design';

export const DEFAULT_MODEL = 'vercel/deepseek/deepseek-v3.2-thinking';
export const DEFAULT_API_KEY_ENV = 'CODE_OWL_LLM_MODEL_API_KEY';

export const MAX_FILE_SIZE_BYTES = 500 * 1024; // 500 KB
export const MAX_CONTEXT_FILES = 50;
export const MAX_TOKENS_PER_FILE = 8000;

/** Hard cap for the number of audit seed files to include in a reviewer's initial context window */
export const MAX_FILES_FOR_REVIEWER_CONTEXT = 40;
/** Maximum characters to include per file when formatting context for a reviewer */
export const MAX_CHARS_PER_REVIEWER_FILE = 6000;
/** Maximum number of audit reviewers to execute concurrently */
export const MAX_CONCURRENT_AUDIT_REVIEWERS = 10;
/** Maximum token budget for a single audit reviewer response. */
export const MAX_AUDIT_REVIEWER_TOKENS = 8096;
/** Maximum wall clock time for one agentic audit reviewer investigation (ms). */
export const MAX_AUDIT_REVIEWER_TIMEOUT_MS = 1_200_000;
/** Maximum wall clock time for one agentic PR reviewer investigation (ms). */
export const MAX_PR_REVIEWER_TIMEOUT_MS = 1_200_000;
/**
 * Maximum wall clock time for a single DirectAI orchestrator call (ms).
 * Slow models (e.g. deepseek-v3.2 via Vercel) can take 8-10 min per response.
 * The orchestrator retries up to 3× at the application layer, so total worst-case
 * is 3 × this value.  Set to 10 min to accommodate genuine model latency without
 * the 3× amplification caused by the OpenAI SDK's built-in maxRetries.
 */
export const MAX_ORCHESTRATOR_TIMEOUT_MS = 600_000;
/** Hard cap on number of reviewers to run in a single PR review. Prevents cost explosion. */
export const MAX_PR_REVIEWERS = 10;
/**
 * Maximum number of PR reviewers to run concurrently.
 * Thinking models (deepseek-reasoner etc.) are slow and share a single OpenCode server process.
 * Firing all reviewers at once saturates the server queue; a rolling window of 6 keeps
 * throughput high while avoiding stalls on later slots.
 */
export const MAX_CONCURRENT_PR_REVIEWERS = 6;
/** Concurrency limit when retrying failed/timed-out PR reviewers (lower to reduce server pressure). */
export const MAX_PR_REVIEWER_RETRY_CONCURRENCY = 3;
/** Maximum number of retry rounds for failed PR reviewers. */
export const MAX_PR_REVIEWER_RETRIES = 1;
/** Maximum number of files an agentic PR reviewer should inspect. */
export const MAX_PR_REVIEWER_FILES_TO_INSPECT = 20;
/** Maximum number of supporting files a PR finding should rely on. */
export const MAX_PR_FINDING_SUPPORT_FILES = 5;
/** Maximum characters of structured diff to include in PR reviewer user messages. */
export const MAX_STRUCTURED_DIFF_CHARS = 24_000;
/** Maximum characters of current file content to seed into PR review prompts. */
export const MAX_PR_CURRENT_FILE_CHARS = 4_000;
/**
 * Maximum total characters of seeded current file context for PR review prompts.
 * Kept intentionally low because agentic reviewers can read full files on demand.
 * The seeded context is a convenience to give the reviewer an overview, not a substitute
 * for filesystem access. Previous value of 80,000 was the main source of token bloat.
 */
export const MAX_PR_CURRENT_CONTEXT_CHARS = 20_000;

/** Default timeout for external scanning tools (ms) */
export const DEFAULT_TOOL_TIMEOUT_MS = 60_000;
/** Default max characters to capture from tool stdout */
export const DEFAULT_TOOL_MAX_OUTPUT_CHARS = 50_000;

export const CODEOWL_SUMMARY_MARKER = '<!-- codeowl-summary -->';
export const CODEOWL_STATUS_MARKER = '<!-- codeowl-status -->';
/**
 * HTML comment marker injected at the start of the aggregated breaking-changes PR comment.
 * The pipeline uses this marker to locate and update the comment on re-runs rather than
 * creating a duplicate. When present, auto-approve is disabled for the PR.
 */
export const CODEOWL_BREAKING_CHANGES_MARKER = '<!-- codeowl-breaking-changes -->';
export const CODEOWL_COMMENT_MARKER = '[CodeOwl';
