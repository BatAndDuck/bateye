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

export const DEFAULT_MODEL = 'anthropic/claude-sonnet-4-5';
export const DEFAULT_API_KEY_ENV = 'CODE_OWL_LLM_MODEL_API_KEY';

export const MAX_FILE_SIZE_BYTES = 500 * 1024; // 500 KB
export const MAX_CONTEXT_FILES = 50;
export const MAX_TOKENS_PER_FILE = 8000;

/** Maximum number of files to include in a reviewer's context window */
export const MAX_FILES_FOR_REVIEWER_CONTEXT = 40;
/** Maximum characters to include per file when formatting context for a reviewer */
export const MAX_CHARS_PER_REVIEWER_FILE = 6000;
/** Maximum number of audit reviewers to execute concurrently */
export const MAX_CONCURRENT_AUDIT_REVIEWERS = 10;
/** Maximum token budget for a single audit reviewer response. */
export const MAX_AUDIT_REVIEWER_TOKENS = 8096;

export const CODEOWL_SUMMARY_MARKER = '<!-- codeowl-summary -->';
export const CODEOWL_STATUS_MARKER = '<!-- codeowl-status -->';
export const CODEOWL_COMMENT_MARKER = '[CodeOwl';
