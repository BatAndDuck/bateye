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

export interface ReviewPlatform {
  getPullRequestContext(): Promise<PullRequestContext>;
  publishInlineComment(comment: InlineComment): Promise<void>;
  publishSummaryComment(body: string): Promise<void>;
  addReaction(commentId: number, reaction: string): Promise<void>;
  publishStartComment(): Promise<void>;
  updateOrCreateSummary(body: string): Promise<void>;
  approvePR(body: string): Promise<void>;
  listExistingComments(): Promise<ExistingComment[]>;
  listReviewComments(): Promise<ExistingComment[]>;
  updateComment(commentId: number, body: string): Promise<void>;
  findSummaryComment(): Promise<{ id: number; body: string } | null>;
  findStatusComment(): Promise<{ id: number; body: string } | null>;
  updateStatusComment(finalBody: string): Promise<void>;
}
