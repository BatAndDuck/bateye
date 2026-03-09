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
  publishInlineComment(comment: InlineComment): Promise<void>;
  publishSummaryComment(body: string): Promise<void>;
}
