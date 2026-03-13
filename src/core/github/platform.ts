import { Octokit } from 'octokit';
import { ReviewPlatform, PullRequestContext, InlineComment, ExistingComment } from './types';
import { getGitDiff, getChangedFiles } from '../git/index';
import { CODEOWL_SUMMARY_MARKER, CODEOWL_STATUS_MARKER } from '../config/defaults';

export class GitHubReviewPlatform implements ReviewPlatform {
  private octokit: Octokit;
  private owner: string;
  private repo: string;
  private prNumber: number;
  private repoPath: string;
  private cachedHeadSha: string | null = null;

  constructor(options: {
    token: string;
    owner: string;
    repo: string;
    prNumber: number;
    repoPath: string;
  }) {
    if (!options.owner.trim()) {
      throw new Error('GitHub owner is required.');
    }
    if (!options.repo.trim()) {
      throw new Error('GitHub repo is required.');
    }
    if (!Number.isInteger(options.prNumber) || options.prNumber <= 0) {
      throw new Error('GitHub PR number must be a positive integer.');
    }
    if (!options.repoPath.trim()) {
      throw new Error('Repository path is required.');
    }

    this.octokit = new Octokit({ auth: options.token });
    this.owner = options.owner;
    this.repo = options.repo;
    this.prNumber = options.prNumber;
    this.repoPath = options.repoPath;
  }

  private async getHeadSha(): Promise<string> {
    if (this.cachedHeadSha) return this.cachedHeadSha;

    const { data: pr } = await this.octokit.rest.pulls.get({
      owner: this.owner,
      repo: this.repo,
      pull_number: this.prNumber,
    });
    this.cachedHeadSha = pr.head.sha;
    return this.cachedHeadSha!;
  }

  async getPullRequestContext(): Promise<PullRequestContext> {
    const { data: pr } = await this.octokit.rest.pulls.get({
      owner: this.owner,
      repo: this.repo,
      pull_number: this.prNumber,
    });

    this.cachedHeadSha = pr.head.sha;

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
      const commitId = await this.getHeadSha();

      await this.octokit.rest.pulls.createReviewComment({
        owner: this.owner,
        repo: this.repo,
        pull_number: this.prNumber,
        commit_id: commitId,
        path: comment.path,
        line: comment.line,
        side: comment.side || 'RIGHT',
        body: comment.body,
      });
      return true;
    } catch (err) {
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

  async addReaction(commentId: number, reaction: string): Promise<void> {
    try {
      await this.octokit.rest.reactions.createForIssueComment({
        owner: this.owner,
        repo: this.repo,
        comment_id: commentId,
        content: reaction as '+1' | '-1' | 'laugh' | 'confused' | 'heart' | 'hooray' | 'rocket' | 'eyes',
      });
    } catch (err) {
      console.warn(`Could not add reaction to comment ${commentId}: ${(err as Error).message}`);
    }
  }

  async publishStartComment(): Promise<void> {
    // Check if a status comment already exists and update it
    const existing = await this.findStatusComment();
    const body = `${CODEOWL_STATUS_MARKER}\n🦉 **CodeOwl** is reviewing this PR...\n\n_This comment will be updated with results._`;

    if (existing) {
      await this.updateComment(existing.id, body);
    } else {
      await this.octokit.rest.issues.createComment({
        owner: this.owner,
        repo: this.repo,
        issue_number: this.prNumber,
        body,
      });
    }
  }

  async updateOrCreateSummary(body: string): Promise<void> {
    const existing = await this.findSummaryComment();
    if (existing) {
      await this.updateComment(existing.id, body);
    } else {
      await this.publishSummaryComment(body);
    }
  }

  async approvePR(body: string): Promise<boolean> {
    try {
      await this.octokit.rest.pulls.createReview({
        owner: this.owner,
        repo: this.repo,
        pull_number: this.prNumber,
        event: 'APPROVE',
        body,
      });
      return true;
    } catch (err) {
      console.warn(`Could not approve PR: ${(err as Error).message}`);
      return false;
    }
  }

  async listExistingComments(): Promise<ExistingComment[]> {
    try {
      const { data: comments } = await this.octokit.rest.issues.listComments({
        owner: this.owner,
        repo: this.repo,
        issue_number: this.prNumber,
        per_page: 100,
      });

      return comments.map((c: { id: number; body?: string | null; user?: { login?: string } | null; created_at: string }) => ({
        id: c.id,
        body: c.body || '',
        user: c.user?.login || '',
        createdAt: c.created_at,
      }));
    } catch (err) {
      console.warn(`Could not list PR comments: ${(err as Error).message}`);
      return [];
    }
  }

  async listReviewComments(): Promise<ExistingComment[]> {
    try {
      const { data: comments } = await this.octokit.rest.pulls.listReviewComments({
        owner: this.owner,
        repo: this.repo,
        pull_number: this.prNumber,
        per_page: 100,
      });

      return comments.map((c: { id: number; body?: string; path?: string; line?: number | null; user?: { login?: string } | null; created_at: string }) => ({
        id: c.id,
        body: c.body || '',
        path: c.path,
        line: c.line || undefined,
        user: c.user?.login || '',
        createdAt: c.created_at,
      }));
    } catch (err) {
      console.warn(`Could not list review comments: ${(err as Error).message}`);
      return [];
    }
  }

  async updateComment(commentId: number, body: string): Promise<void> {
    await this.octokit.rest.issues.updateComment({
      owner: this.owner,
      repo: this.repo,
      comment_id: commentId,
      body,
    });
  }

  async findSummaryComment(): Promise<{ id: number; body: string } | null> {
    const comments = await this.listExistingComments();
    const found = comments.find(c => c.body.includes(CODEOWL_SUMMARY_MARKER));
    if (found) {
      return { id: found.id, body: found.body };
    }
    return null;
  }

  async findStatusComment(): Promise<{ id: number; body: string } | null> {
    const comments = await this.listExistingComments();
    const found = comments.find(c => c.body.includes(CODEOWL_STATUS_MARKER));
    if (found) {
      return { id: found.id, body: found.body };
    }
    return null;
  }

  async updateStatusComment(finalBody: string): Promise<void> {
    const existing = await this.findStatusComment();
    if (existing) {
      await this.updateComment(existing.id, finalBody);
    }
  }
}

export function getGitHubEnvContext(): { owner: string; repo: string; prNumber: number } | null {
  const repository = process.env.GITHUB_REPOSITORY;
  const prNumberStr = process.env.PR_NUMBER || process.env.GITHUB_REF?.match(/refs\/pull\/(\d+)\/merge/)?.[1];

  if (!repository || !prNumberStr) return null;

  const repositoryParts = repository.split('/');
  if (repositoryParts.length !== 2 || !repositoryParts[0] || !repositoryParts[1]) return null;

  const [owner, repo] = repositoryParts;
  const prNumber = parseInt(prNumberStr, 10);
  if (!owner || !repo || !Number.isInteger(prNumber) || prNumber <= 0) return null;

  return { owner, repo, prNumber };
}
