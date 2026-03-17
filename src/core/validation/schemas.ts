import { z } from 'zod';

// Neutral midpoint confidence when an AI reviewer does not express certainty
const DEFAULT_CONFIDENCE = 0.5;

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

export const serviceDesignDocSchema = z.object({
  serviceId: z.string(),
  name: z.string(),
  kind: z.enum(['service', 'module', 'library', 'app', 'worker', 'gateway', 'resource']),
  resourceCategory: z.enum([
    'database',
    'cache',
    'queue',
    'storage',
    'vector-search',
    'external-saas',
    'external-api',
    'internal-platform',
  ]).optional(),
  purpose: z.string(),
  responsibilities: z.array(z.string()),
  capabilities: z.array(z.string()),
  publicInterfaces: z.array(z.object({
    type: z.enum(['http', 'graphql', 'event', 'queue', 'cron', 'db']),
    name: z.string(),
    description: z.string().optional(),
  })),
  integrations: z.array(z.object({
    name: z.string(),
    description: z.string().max(200),
    internal: z.boolean(),
    instanceKey: z.string().optional(),
    category: z.enum([
      'database',
      'cache',
      'queue',
      'storage',
      'vector-search',
      'external-saas',
      'external-api',
      'internal-platform',
    ]).optional(),
  })),
  dependencies: z.array(z.string()),
  entities: z.array(z.object({
    name: z.string(),
    description: z.string().optional(),
    fields: z.array(z.string()).optional(),
  })),
  submodules: z.array(z.string()),
  complexityScore: z.number().min(1).max(10),
  risks: z.array(z.string()),
  confidence: z.number().min(0).max(1).default(DEFAULT_CONFIDENCE),
  evidence: z.object({
    filePaths: z.array(z.string()),
    reasons: z.array(z.string()),
  }).default({ filePaths: [], reasons: [] }),
  discoverySources: z.array(z.string()).default([]),
  gaps: z.array(z.string()).default([]),
  conflicts: z.array(z.string()).default([]),
});

export const orchestratorResultSchema = z.object({
  selectedReviewers: z.array(z.object({
    reviewerId: z.string(),
    reason: z.string(),
  })),
});

export const systemSynthesisSchema = z.object({
  architectureType: z.enum([
    'monolith',
    'modular-monolith',
    'distributed-monolith',
    'microservices',
    'hybrid-service-oriented',
    'event-driven-hybrid',
  ]),
  score: z.number().min(0).max(100),
  strengths: z.array(z.string()),
  weaknesses: z.array(z.string()),
  globalSummary: z.string(),
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
export type PRFindingVerification = z.infer<typeof prFindingVerificationSchema>;
export type PRFindingBatchVerification = z.infer<typeof prFindingBatchVerificationSchema>;
export type OrchestratorAnalysis = z.infer<typeof orchestratorResultSchema>;
export type SystemSynthesis = z.infer<typeof systemSynthesisSchema>;
export type ServiceDoc = z.infer<typeof serviceDesignDocSchema>;
