import * as fs from 'fs';
import * as path from 'path';
import matter from 'gray-matter';
import { Reviewer } from '../../types/index';
import { ReviewerLoadResult } from './types';
import { REVIEWERS_DIR } from '../config/defaults';

const BUILTIN_REVIEWER_DIR_CANDIDATES = [
  path.resolve(__dirname, '../../templates/reviewers'),
  path.resolve(__dirname, '../../../src/templates/reviewers'),
];

function getBuiltInReviewerDirs(): string[] {
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
    return {
      id: String(data.id),
      name: String(data.name),
      description: data.description ? String(data.description) : undefined,
      enabled: data.enabled !== false,
      scopeHints: Array.isArray(data.scopeHints) ? data.scopeHints.map(String) : undefined,
      recommendedGlobs: Array.isArray(data.recommendedGlobs) ? data.recommendedGlobs.map(String) : undefined,
      model: data.model ? String(data.model) : undefined,
      instructions: content.trim(),
      sourcePath: filePath,
      isBuiltIn,
    };
  } catch {
    return null;
  }
}

function loadReviewersFromDir(dir: string, isBuiltIn: boolean): { reviewers: Reviewer[]; warnings: string[] } {
  const warnings: string[] = [];
  const reviewers: Reviewer[] = [];

  if (!fs.existsSync(dir)) {
    return { reviewers, warnings };
  }

  const files = fs.readdirSync(dir).filter(f => f.endsWith('.md'));
  for (const file of files) {
    const filePath = path.join(dir, file);
    const reviewer = parseReviewerFile(filePath, isBuiltIn);
    if (reviewer) {
      reviewers.push(reviewer);
    } else {
      warnings.push(`Skipping invalid reviewer: ${filePath} (missing id or name)`);
    }
  }
  return { reviewers, warnings };
}

export function loadReviewers(repoPath: string): ReviewerLoadResult {
  const warnings: string[] = [];

  const reviewerMap = new Map<string, Reviewer>();
  const builtInDirs = getBuiltInReviewerDirs();
  for (const dir of builtInDirs) {
    const builtIn = loadReviewersFromDir(dir, true);
    warnings.push(...builtIn.warnings);
    for (const reviewer of builtIn.reviewers) {
      reviewerMap.set(reviewer.id, reviewer);
    }
  }

  if (builtInDirs.length === 0) {
    warnings.push('No built-in reviewer directory found. Expected templates/reviewers in dist or src.');
  }

  const userDir = path.join(repoPath, REVIEWERS_DIR);
  const user = loadReviewersFromDir(userDir, false);
  warnings.push(...user.warnings);
  for (const reviewer of user.reviewers) {
    reviewerMap.set(reviewer.id, reviewer);
  }

  const reviewers = Array.from(reviewerMap.values()).filter(r => r.enabled !== false);
  return { reviewers, warnings };
}
