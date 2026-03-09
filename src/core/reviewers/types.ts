import { ReviewerMetadata, Reviewer } from '../../types/index';

export type ReviewerLoadResult = {
  reviewers: Reviewer[];
  warnings: string[];
};
