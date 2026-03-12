import { ReviewerMetadata, Reviewer } from '../../types/index';

/**
 * Result of loading reviewers from the filesystem.
 * Contains the loaded reviewers and any non-fatal warnings encountered during loading
 * (e.g. duplicate IDs, unreadable files, or invalid frontmatter).
 */
export type ReviewerLoadResult = {
  reviewers: Reviewer[];
  warnings: string[];
};
