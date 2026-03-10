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

export interface ReviewPlatform {
  getPullRequestContext(): Promise<PullRequestContext>;
  /** Returns true if the comment was posted inline, false if the line was not in the diff. */
  publishInlineComment(comment: InlineComment): Promise<boolean>;
  publishSummaryComment(body: string): Promise<void>;
}
