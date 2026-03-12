import { PRReviewResult } from '../../types/index';
import { runPRReviewPipeline, PRReviewPipelineOptions } from './pipeline';

// Backward-compatible interface
export interface PRReviewOptions {
  repoPath: string;
  baseRef?: string;
  headRef?: string;
  github?: boolean;
  githubToken?: string;
  prNumber?: number;
  dryRun?: boolean;
  onProgress?: (msg: string) => void;
}

export async function runPRReview(options: PRReviewOptions): Promise<PRReviewResult> {
  return runPRReviewPipeline(options);
}
