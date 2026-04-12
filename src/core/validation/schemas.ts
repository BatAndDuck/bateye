import { z } from 'zod';

export const prioritySchema = z.enum(['critical', 'high', 'medium', 'low', 'info']);

const findingRangeFields = {
  id: z.string(),
  title: z.string(),
  description: z.string(),
  priority: prioritySchema,
  confidence: z.number().min(0).max(1),
  filePath: z.string(),
  startLine: z.number().int().min(1),
  endLine: z.number().int().min(1),
  startColumn: z.number().int().min(1).optional(),
  endColumn: z.number().int().min(1).optional(),
  evidence: z.array(z.string()),
  applicabilityNote: z.string().optional(),
  recommendation: z.string(),
  tags: z.array(z.string()).optional(),
};

function withValidLineRange<T extends z.ZodRawShape>(shape: T) {
  return z.object(shape)
    .refine(
      finding => finding.endLine >= finding.startLine,
      {
        message: 'endLine must be greater than or equal to startLine',
        path: ['endLine'],
      },
    )
    .refine(
      finding => !finding.endColumn || !finding.startColumn || finding.endColumn >= finding.startColumn,
      {
        message: 'endColumn must be greater than or equal to startColumn',
        path: ['endColumn'],
      },
    );
}

export const findingSchema = withValidLineRange({
  ...findingRangeFields,
  reviewerId: z.string(),
  reviewerName: z.string(),
});

const reviewerFindingSchema = withValidLineRange(findingRangeFields);

const prReviewerFindingSchema = withValidLineRange({
  ...findingRangeFields,
  codeQuote: z.string().min(1),
  verificationTrail: z.array(z.string()).min(1).max(5),
  searchedFor: z.array(z.string()).max(5).optional(),
});

export const prFindingSchema = withValidLineRange({
  ...findingRangeFields,
  reviewerId: z.string(),
  reviewerName: z.string(),
  codeQuote: z.string().min(1),
  verificationTrail: z.array(z.string()).min(1).max(5),
  searchedFor: z.array(z.string()).max(5).optional(),
});

export const reviewerResultSchema = z.object({
  reviewerId: z.string(),
  reviewerName: z.string(),
  description: z.string().optional(),
  score: z.number().min(0).max(100),
  summary: z.string(),
  findings: z.array(findingSchema),
  execution: z.object({
    model: z.string(),
    runtime: z.enum(['sdk', 'cli']),
    durationMs: z.number(),
    scopedFiles: z.number(),
    totalRepoFilesSeen: z.number(),
    warnings: z.array(z.string()).optional(),
  }),
});

export const executionGroupSchema = z.object({
  groupId: z.string(),
  mode: z.enum(['standard', 'deep']).default('standard'),
  reason: z.string(),
  reviewerIds: z.array(z.string()).min(1),
});

export const orchestratorResultSchema = z.object({
  selectedReviewers: z.array(z.object({
    reviewerId: z.string(),
    reason: z.string(),
    confidence: z.number().min(0).max(1),
  })),
  intentSummary: z.string(),
  executionPlan: z.array(executionGroupSchema).optional(),
});

export const reviewerAnalysisSchema = z.object({
  score: z.number().min(0).max(100),
  summary: z.string(),
  findings: z.array(reviewerFindingSchema),
});

export const prReviewerAnalysisSchema = z.object({
  score: z.number().min(0).max(100),
  summary: z.string(),
  findings: z.array(prReviewerFindingSchema),
});

/**
 * Per-finding schema used when multiple reviewers share a single agentic session
 * (bundle execution). Each finding MUST carry a `reviewerId` so the pipeline can
 * attribute it back to the originating reviewer after the bundle returns.
 */
const prBundleFindingSchema = withValidLineRange({
  ...findingRangeFields,
  reviewerId: z.string().min(1),
  codeQuote: z.string().min(1),
  verificationTrail: z.array(z.string()).min(1).max(5),
  searchedFor: z.array(z.string()).max(5).optional(),
});

/**
 * Response schema for a bundle run. `perReviewer` carries one summary+score entry
 * per reviewer in the bundle; `findings` is a flat list with each finding tagged
 * by its originating reviewerId. The pipeline resolves reviewerId → Reviewer to
 * build per-reviewer PRReviewerRunResult entries for downstream verification.
 */
export const prBundleAnalysisSchema = z.object({
  perReviewer: z.array(z.object({
    reviewerId: z.string().min(1),
    score: z.number().min(0).max(100),
    summary: z.string(),
  })),
  findings: z.array(prBundleFindingSchema),
});

export const prFindingVerificationSchema = z.object({
  supported: z.boolean(),
  reason: z.string(),
  counterEvidence: z.array(z.string()).default([]),
});

export const prFindingBatchVerificationSchema = z.object({
  verifications: z.array(z.object({
    findingId: z.string(),
    supported: z.boolean(),
    classification: z.enum(['direct', 'companion', 'unrelated', 'unclear']),
    reason: z.string(),
  })),
});

export type ReviewerAnalysis = z.infer<typeof reviewerAnalysisSchema>;
export type PRReviewerAnalysis = z.infer<typeof prReviewerAnalysisSchema>;
export type PRBundleAnalysis = z.infer<typeof prBundleAnalysisSchema>;
export type PRFindingVerification = z.infer<typeof prFindingVerificationSchema>;
export type PRFindingBatchVerification = z.infer<typeof prFindingBatchVerificationSchema>;
export type OrchestratorAnalysis = z.infer<typeof orchestratorResultSchema>;
