import { ReviewerResult } from '../../types/index';

/**
 * Clamp a score to [0, 100].
 */
export function clampScore(score: number): number {
  return Math.max(0, Math.min(100, Math.round(score)));
}

/**
 * Normalize a reviewer's raw score to [0, 100].
 * The reviewer proposes a score; we ensure it's valid.
 */
export function normalizeReviewerScore(rawScore: number | undefined): number {
  if (rawScore === undefined || rawScore === null || isNaN(rawScore)) {
    return 50; // neutral default
  }
  return clampScore(rawScore);
}

/**
 * Compute overall score as weighted average of reviewer scores.
 * Critical/high finding counts reduce the score.
 */
export function computeOverallScore(reviewerResults: ReviewerResult[]): number {
  if (reviewerResults.length === 0) return 100;

  const total = reviewerResults.reduce((sum, r) => sum + normalizeReviewerScore(r.score), 0);
  const avg = total / reviewerResults.length;

  // Apply penalty for critical findings
  const criticalCount = reviewerResults.flatMap(r => r.findings).filter(f => f.priority === 'critical').length;
  const highCount = reviewerResults.flatMap(r => r.findings).filter(f => f.priority === 'high').length;

  const penalty = Math.max(20, criticalCount * 5 + highCount * 2);

  return clampScore(avg - penalty);
}

/**
 * Generate a human-readable grade from a score.
 */
export function scoreToGrade(score: number): string {
  if (score >= 90) return 'A';
  if (score >= 80) return 'B';
  if (score >= 70) return 'C';
  if (score >= 60) return 'D';
  return 'F';
}

export function scoreToLabel(score: number): string {
  if (score >= 90) return 'Excellent';
  if (score >= 75) return 'Good';
  if (score >= 60) return 'Needs Improvement';
  if (score >= 40) return 'Poor';
  return 'Critical Issues';
}
