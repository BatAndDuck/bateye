import * as fs from 'fs';
import * as path from 'path';
import matter from 'gray-matter';
import { Reviewer } from '../../types/index';
import { ReviewerLoadResult } from './types';
import { REVIEWERS_DIR } from '../config/defaults';

const BUILTIN_REVIEWERS_DIR = path.join(__dirname, '../../templates/reviewers');

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

  // Load built-in reviewers
  const builtIn = loadReviewersFromDir(BUILTIN_REVIEWERS_DIR, true);
  warnings.push(...builtIn.warnings);

  // Load user reviewers
  const userDir = path.join(repoPath, REVIEWERS_DIR);
  const user = loadReviewersFromDir(userDir, false);
  warnings.push(...user.warnings);

  // User reviewers override built-ins with same id
  const reviewerMap = new Map<string, Reviewer>();
  for (const r of builtIn.reviewers) {
    reviewerMap.set(r.id, r);
  }
  for (const r of user.reviewers) {
    reviewerMap.set(r.id, r);
  }

  const reviewers = Array.from(reviewerMap.values()).filter(r => r.enabled !== false);
  return { reviewers, warnings };
}
