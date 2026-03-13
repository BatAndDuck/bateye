import * as fs from 'fs';
import * as path from 'path';
import matter from 'gray-matter';
import { Reviewer, ReviewerMode, Config } from '../../../types/index';
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

function parseReviewerFile(filePath: string, isBuiltIn: boolean): Reviewer | null {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const { data, content } = matter(raw);
    if (!data.id || !data.name) {
      return null;
    }

    const validModes: ReviewerMode[] = ['audit', 'pr-review', 'both'];
    const rawMode = data.mode ? String(data.mode) : 'both';
    const mode: ReviewerMode = validModes.includes(rawMode as ReviewerMode)
      ? (rawMode as ReviewerMode)
      : 'both';

    return {
      id: String(data.id),
      name: String(data.name),
      description: data.description ? String(data.description) : undefined,
      enabled: data.enabled !== false,
      scopeHints: Array.isArray(data.scopeHints) ? data.scopeHints.map(String) : undefined,
      model: data.model ? String(data.model) : undefined,
      mode,
      category: data.category ? String(data.category) as Reviewer['category'] : undefined,
      instructions: content.trim(),
      sourcePath: filePath,
      isBuiltIn,
    };
  } catch {
    return null;
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
    const reviewer = parseReviewerFile(path.join(dir, fileName), isBuiltIn);
    if (reviewer) {
      reviewers.push(reviewer);
    } else {
      warnings.push(`Skipping invalid reviewer: ${path.join(dir, fileName)} (missing id or name)`);
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
    reviewers: Array.from(reviewerMap.values()).filter(r => r.enabled !== false),
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
