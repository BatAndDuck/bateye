export interface InlineComment {
  body: string;
  path: string;
  line: number;
  side?: 'LEFT' | 'RIGHT';
}

export interface PullRequestContext {
  owner: string;
  repo: string;
  prNumber: number;
  baseRef: string;
  headRef: string;
  baseCommitSha: string;
  headCommitSha: string;
  changedFiles: string[];
  diff: string;
}

export interface ExistingComment {
  id: number;
  body: string;
  path?: string;
  line?: number;
  user: string;
  createdAt: string;
}

/**
 * Interface for publishing review comments to a VCS pull request platform.
 * Implement this to add support for platforms beyond the default GitHub implementation.
 *
 * Each method is called by the PR review pipeline at well-defined stages:
 * - `publishStartComment` / `updateStatusComment` - bookend the review run
 * - `publishInlineComment` - posts a finding as a line-level comment on the diff
 * - `updateOrCreateSummary` - upserts the overall summary comment
 * - `approvePR` - submits a formal approval when all findings are below the configured threshold
 */
export interface ReviewPlatform {
  getPullRequestContext(): Promise<PullRequestContext>;
  /** Post a finding as a line-level comment on the diff. Returns true if posted successfully. */
  publishInlineComment(comment: InlineComment): Promise<boolean>;
  publishSummaryComment(body: string): Promise<void>;
  addReaction(commentId: number, reaction: '+1' | '-1' | 'laugh' | 'confused' | 'heart' | 'hooray' | 'rocket' | 'eyes'): Promise<void>;
  publishStartComment(): Promise<void>;
  /** Update the summary comment if it already exists, otherwise create it */
  updateOrCreateSummary(body: string): Promise<void>;
  /** Update the breaking-changes comment if it already exists, otherwise create it */
  updateOrCreateBreakingChangesComment(body: string): Promise<void>;
  /** Submits a formal approval. Returns true on success, false if the token lacks permission. */
  approvePR(body: string): Promise<boolean>;
  listExistingComments(): Promise<ExistingComment[]>;
  listReviewComments(): Promise<ExistingComment[]>;
  updateComment(commentId: number, body: string): Promise<void>;
  findSummaryComment(): Promise<{ id: number; body: string } | null>;
  findStatusComment(): Promise<{ id: number; body: string } | null>;
  updateStatusComment(finalBody: string): Promise<void>;
}
