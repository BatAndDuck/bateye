import * as fs from 'fs';
import * as path from 'path';
import matter from 'gray-matter';
import { Reviewer, ReviewerMode, ReviewerToolConfig, Config } from '../../../types/index';
import { ReviewerLoadResult } from '../../../core/reviewers/types';
import { REVIEWERS_DIR } from '../../../core/config/defaults';

const BUILTIN_REVIEWER_DIR_CANDIDATES = [
  path.resolve(__dirname, '../../audit/builtin-reviewers'),
  path.resolve(__dirname, '../../../../src/features/audit/builtin-reviewers'),
];

export function getBuiltInReviewerDirs(): string[] {
  const seen = new Set<string>();
  const dirs: string[] = [];

  for (const candidate of BUILTIN_REVIEWER_DIR_CANDIDATES) {
    if (fs.existsSync(candidate) && !seen.has(candidate)) {
      seen.add(candidate);
      dirs.push(candidate);
    }
  }

  return dirs;
}

function parseReviewerFile(
  filePath: string,
  isBuiltIn: boolean,
): { reviewer: Reviewer | null; error?: string } {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const { data, content } = matter(raw);
    if (!data.id || !data.name) {
      return { reviewer: null, error: 'missing required frontmatter fields "id" or "name"' };
    }

    const validModes: ReviewerMode[] = ['audit', 'pr-review', 'both'];
    const rawMode = data.mode ? String(data.mode) : 'both';
    const mode: ReviewerMode = validModes.includes(rawMode as ReviewerMode)
      ? (rawMode as ReviewerMode)
      : 'both';

    return {
      reviewer: {
        id: String(data.id),
        name: String(data.name),
        description: data.description ? String(data.description) : undefined,
        enabled: data.enabled !== false,
        selectWhen: data.selectWhen ? String(data.selectWhen) : undefined,
        model: data.model ? String(data.model) : undefined,
        mode,
        category: data.category ? String(data.category) as Reviewer['category'] : undefined,
        tool: parseToolConfig(data.tool),
        instructions: content.trim(),
        sourcePath: filePath,
        isBuiltIn,
      },
    };
  } catch (err) {
    return { reviewer: null, error: (err as Error).message };
  }
}

function loadReviewersFromDir(dir: string, isBuiltIn: boolean): ReviewerLoadResult {
  const warnings: string[] = [];
  const reviewers: Reviewer[] = [];

  if (!fs.existsSync(dir)) {
    return { reviewers, warnings };
  }

  const files = fs.readdirSync(dir).filter(fileName => fileName.endsWith('.md'));
  for (const fileName of files) {
    const filePath = path.join(dir, fileName);
    const { reviewer, error } = parseReviewerFile(filePath, isBuiltIn);
    if (reviewer) {
      reviewers.push(reviewer);
    } else {
      warnings.push(`Skipping reviewer ${filePath}: ${error || 'invalid reviewer file'}`);
    }
  }

  return { reviewers, warnings };
}

function buildAllReviewers(repoPath: string): ReviewerLoadResult {
  const warnings: string[] = [];
  const reviewerMap = new Map<string, Reviewer>();

  const builtInDirs = getBuiltInReviewerDirs();
  for (const dir of builtInDirs) {
    const result = loadReviewersFromDir(dir, true);
    warnings.push(...result.warnings);
    for (const reviewer of result.reviewers) {
      reviewerMap.set(reviewer.id, reviewer);
    }
  }

  if (builtInDirs.length === 0) {
    warnings.push('No built-in reviewer directory found. Expected feature-owned reviewer definitions in dist or src.');
  }

  const userDir = path.join(repoPath, REVIEWERS_DIR);
  const userResult = loadReviewersFromDir(userDir, false);
  warnings.push(...userResult.warnings);
  for (const reviewer of userResult.reviewers) {
    reviewerMap.set(reviewer.id, reviewer);
  }

  return {
    reviewers: Array.from(reviewerMap.values()),
    warnings,
  };
}

/** Load all enabled reviewers (both modes). Backwards-compatible. */
export function loadReviewers(repoPath: string): ReviewerLoadResult {
  return buildAllReviewers(repoPath);
}

/**
 * Load reviewers filtered by mode and applying per-mode disabledReviewers from config.
 * Reviewers with mode 'both' are always included in either mode.
 */
function parseToolConfig(raw: unknown): ReviewerToolConfig | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const obj = raw as Record<string, unknown>;
  if (typeof obj.command !== 'string') return undefined;
  return {
    command: obj.command,
    args: Array.isArray(obj.args) ? obj.args.map(String) : [],
    targeting: obj.targeting === 'file' ? 'file' : 'project',
    fileArgs: obj.fileArgs === true,
    timeout: typeof obj.timeout === 'number' ? obj.timeout : undefined,
    maxOutputChars: typeof obj.maxOutputChars === 'number' ? obj.maxOutputChars : undefined,
    optional: obj.optional !== false,
  };
}

export function loadReviewersForMode(
  repoPath: string,
  mode: ReviewerMode,
  config?: Pick<Config, 'disabledReviewers'>,
): ReviewerLoadResult {
  const { reviewers, warnings } = buildAllReviewers(repoPath);

  const disabledIds = new Set<string>(
    mode === 'audit'
      ? (config?.disabledReviewers?.audit ?? [])
      : (config?.disabledReviewers?.prReview ?? []),
  );

  const filtered = reviewers.filter(r => {
    const reviewerMode = r.mode ?? 'both';
    const modeMatch = reviewerMode === 'both' || reviewerMode === mode;
    return modeMatch && !disabledIds.has(r.id);
  });

  return { reviewers: filtered, warnings };
}
