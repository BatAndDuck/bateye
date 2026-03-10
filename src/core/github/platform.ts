import { Octokit } from 'octokit';
import { ReviewPlatform, PullRequestContext, InlineComment } from './types';
import { getGitDiff, getChangedFiles } from '../git/index';

export class GitHubReviewPlatform implements ReviewPlatform {
  private octokit: Octokit;
  private owner: string;
  private repo: string;
  private prNumber: number;
  private repoPath: string;

  constructor(options: {
    token: string;
    owner: string;
    repo: string;
    prNumber: number;
    repoPath: string;
  }) {
    this.octokit = new Octokit({ auth: options.token });
    this.owner = options.owner;
    this.repo = options.repo;
    this.prNumber = options.prNumber;
    this.repoPath = options.repoPath;
  }

  async getPullRequestContext(): Promise<PullRequestContext> {
    const { data: pr } = await this.octokit.rest.pulls.get({
      owner: this.owner,
      repo: this.repo,
      pull_number: this.prNumber,
    });

    const baseRef = pr.base.ref;
    const headRef = pr.head.ref;
    const baseCommitSha = pr.base.sha;
    const headCommitSha = pr.head.sha;

    const changedFiles = await getChangedFiles(this.repoPath, `origin/${baseRef}`, 'HEAD');
    const diff = await getGitDiff(this.repoPath, `origin/${baseRef}`, 'HEAD');

    return {
      owner: this.owner,
      repo: this.repo,
      prNumber: this.prNumber,
      baseRef,
      headRef,
      baseCommitSha,
      headCommitSha,
      changedFiles,
      diff,
    };
  }

  async publishInlineComment(comment: InlineComment): Promise<boolean> {
    try {
      const { data: pr } = await this.octokit.rest.pulls.get({
        owner: this.owner,
        repo: this.repo,
        pull_number: this.prNumber,
      });

      await this.octokit.rest.pulls.createReviewComment({
        owner: this.owner,
        repo: this.repo,
        pull_number: this.prNumber,
        commit_id: pr.head.sha,
        path: comment.path,
        line: comment.line,
        side: comment.side || 'RIGHT',
        body: comment.body,
      });
      return true;
    } catch (err) {
      // Line is not in the diff — caller will post as a standalone comment
      console.warn(`Could not post inline comment for ${comment.path}:${comment.line}: ${(err as Error).message}`);
      return false;
    }
  }

  async publishSummaryComment(body: string): Promise<void> {
    await this.octokit.rest.issues.createComment({
      owner: this.owner,
      repo: this.repo,
      issue_number: this.prNumber,
      body,
    });
  }
}

export function getGitHubEnvContext(): { owner: string; repo: string; prNumber: number } | null {
  // GitHub Actions environment variables
  const repository = process.env.GITHUB_REPOSITORY;
  const prNumberStr = process.env.PR_NUMBER || process.env.GITHUB_REF?.match(/refs\/pull\/(\d+)\/merge/)?.[1];

  if (!repository || !prNumberStr) return null;

  const [owner, repo] = repository.split('/');
  const prNumber = parseInt(prNumberStr, 10);
  if (!owner || !repo || isNaN(prNumber)) return null;

  return { owner, repo, prNumber };
}
