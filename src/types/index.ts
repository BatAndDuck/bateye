/** Severity level for a code review finding */
export type Priority = "critical" | "high" | "medium" | "low" | "info";

/** Which runtime implementation was used to execute an AI review */
export type RuntimeType = "sdk" | "cli";

export type ReviewRunStatus = "complete" | "degraded";

export type ReviewIssue = {
  severity: "warning" | "error";
  code: string;
  message: string;
  stage?: string;
  reviewerId?: string;
  reviewerName?: string;
};

/** Represents a single finding from a code reviewer */
export type Finding = {
  id: string;
  reviewerId: string;
  reviewerName: string;
  title: string;
  description: string;
  priority: Priority;
  confidence: number;
  filePath: string;
  startLine: number;
  endLine: number;
  startColumn?: number;
  endColumn?: number;
  evidence: string[];
  /** One-sentence explanation of why this finding applies to the specific codebase being reviewed */
  applicabilityNote?: string;
  recommendation: string;
  tags?: string[];
};

/** A PR review finding that extends Finding with a mandatory verbatim code quote for inline commenting */
export type PRFinding = Finding & {
  codeQuote: string;
  verificationTrail: string[];
  searchedFor?: string[];
};

/** Token usage for a single LLM call or aggregated across multiple calls */
export type TokenUsageSummary = {
  inputTokens: number;
  outputTokens: number;
  /** True when counts are estimated from character length rather than reported by the API */
  estimated?: boolean;
};

/** The full output from a single reviewer, including score, summary, and all findings */
export type ReviewerResult = {
  reviewerId: string;
  reviewerName: string;
  description?: string;
  score: number;
  summary: string;
  findings: Finding[];
  tokensUsed?: TokenUsageSummary;
  execution: {
    model: string;
    runtime: RuntimeType;
    durationMs: number;
    scopedFiles: number;
    totalRepoFilesSeen: number;
    warnings?: string[];
    toolRan?: boolean;
    toolDurationMs?: number;
    toolError?: string;
    toolOutput?: string;
  };
};

/** Full codebase audit output, aggregating all reviewer results into an overall score */
export type AuditResult = {
  command: "audit";
  repoPath: string;
  status: ReviewRunStatus;
  overallScore: number;
  summary: string;
  reviewerResults: ReviewerResult[];
  issues: ReviewIssue[];
  tokenUsage?: TokenUsageSummary;
  generatedAt: string;
  codeowlVersion?: string;
  verificationStats?: {
    rawFindings: number;
    confidenceRejected: number;
    deterministicRejected: number;
    semanticRejected: number;
    finalFindings: number;
  };
};

/** PR review output containing all inline findings and an overall summary */
export type PRReviewResult = {
  command: "pr-review";
  baseRef: string;
  headRef: string;
  status: ReviewRunStatus;
  selectedReviewers: {
    reviewerId: string;
    reason: string;
    confidence: number;
  }[];
  summary: string;
  findings: PRFinding[];
  issues: ReviewIssue[];
  rejectedFindings?: number;
  verificationStats?: {
    rawFindings: number;
    confidenceRejected: number;
    deterministicRejected: number;
    diffGateRejected: number;
    semanticRejected: number;
    finalFindings: number;
  };
  tokenUsage?: TokenUsageSummary;
  generatedAt: string;
  autoApproved?: boolean;
  codeowlVersion?: string;
};

/** The communication interface type exposed by a service (e.g. REST, GraphQL, event stream) */
export type ServiceInterfaceType = "http" | "graphql" | "event" | "queue" | "cron" | "db";

/** Classifies the type of architectural code unit detected in the repository */
export type ServiceKind = "service" | "module" | "library" | "app" | "worker" | "gateway" | "resource";

/** Category of an external dependency or infrastructure integration */
export type ResourceCategory =
  | "database"
  | "cache"
  | "queue"
  | "storage"
  | "vector-search"
  | "external-saas"
  | "external-api"
  | "internal-platform";

/** A reference to a specific file that provided evidence for an architectural decision */
export type EvidenceRef = {
  filePath: string;
  reason: string;
  signal?: string;
};

/** A reference to an external or internal service that a unit integrates with */
export type IntegrationRef = {
  name: string;
  description: string;
  internal: boolean;
  category?: ResourceCategory;
  instanceKey?: string;
};

/** Architecture analysis document for a single service or module */
export type ServiceDesignDoc = {
  serviceId: string;
  name: string;
  kind: ServiceKind;
  resourceCategory?: ResourceCategory;
  purpose: string;
  responsibilities: string[];
  capabilities: string[];
  publicInterfaces: {
    type: ServiceInterfaceType;
    name: string;
    description?: string;
  }[];
  integrations: IntegrationRef[];
  dependencies: string[];
  entities: {
    name: string;
    description?: string;
    fields?: string[];
  }[];
  submodules: string[];
  complexityScore: number;
  risks: string[];
  confidence: number;
  evidence: {
    filePaths: string[];
    reasons: string[];
  };
  discoverySources: string[];
  gaps: string[];
  conflicts: string[];
};

export type ArchitectureType =
  | "monolith"
  | "modular-monolith"
  | "distributed-monolith"
  | "microservices"
  | "hybrid-service-oriented"
  | "event-driven-hybrid";

/** Complete system architecture analysis, containing all service docs, graph data, and coverage metrics */
export type SystemDesignResult = {
  command: "system-design";
  repoPath: string;
  architectureType: ArchitectureType;
  score: number;
  strengths: string[];
  weaknesses: string[];
  services: ServiceDesignDoc[];
  globalSummary: string;
  coverage: {
    overallConfidence: number;
    gaps: string[];
    conflicts: string[];
    unitCoverage: Array<{
      unitId: string;
      name: string;
      confidence: number;
      seedFileCount: number;
      selectedFileCount: number;
      analyzedFileCount: number;
      retrievalIterations: number;
      gaps: string[];
      conflicts: string[];
    }>;
  };
  artifacts: {
    htmlReportPath: string;
    graphDataPath: string;
    servicesDir: string;
    unitsDir: string;
    inventoryPath: string;
    coveragePath: string;
    architecturePath: string;
  };
  generatedAt: string;
};

export type SystemDesignInventoryUnit = {
  unitId: string;
  name: string;
  kindHint?: ServiceKind;
  dirPath: string;
  seedFiles: string[];
  candidateFiles: string[];
  selectedFiles: string[];
  dependencyHints: string[];
  integrationHints: IntegrationRef[];
  discoverySources: string[];
  evidence: EvidenceRef[];
  confidence: number;
};

export type SystemDesignInventory = {
  generatedAt: string;
  repoPath: string;
  units: SystemDesignInventoryUnit[];
  integrations: IntegrationRef[];
  gaps: string[];
  conflicts: string[];
};

export type PRReviewConfig = {
  autoApprove?: {
    enabled: boolean;
    maxSeverity?: "info" | "low" | "medium";
  };
  /** Maximum number of reviewers to run in a single PR review.
   * When the orchestrator selects more reviewers than this limit, the ones with
   * the highest confidence scores are kept. Defaults to no limit (up to the
   * absolute hard cap MAX_PR_REVIEWERS). */
  maxReviewers?: number;
  /** Controls the LLM-based semantic verification pass that confirms findings are real.
   * Disabling it skips the pass entirely — faster and cheaper, but may let false-positives through.
   * Defaults to enabled. */
  semanticVerification?: {
    enabled: boolean;
  };
};

/** Repository-level configuration loaded from `.codeowl/config.json`. */
export type Config = {
  $schema?: string;
  model?: string;
  transport?: string;
  apiBaseUrl?: string;
  exclude?: string[];
  prReview?: PRReviewConfig;
  /** Per-mode reviewer IDs to disable. */
  disabledReviewers?: {
    audit?: string[];
    prReview?: string[];
  };
};

/** Controls which review mode(s) a reviewer participates in. Defaults to 'both'. */
export type ReviewerMode = 'audit' | 'pr-review' | 'both';

/** Whether a tool targets individual files or the whole project */
export type ToolTargeting = 'file' | 'project';

/** Configuration for an external scanning tool attached to a reviewer */
export type ReviewerToolConfig = {
  command: string;
  args: string[];
  /** 'file' appends changed files to args in PR mode; 'project' runs on the whole project */
  targeting?: ToolTargeting;
  /** When targeting=file, append file paths to the end of args */
  fileArgs?: boolean;
  /** Timeout in milliseconds (default 60000) */
  timeout?: number;
  /** Truncate tool stdout beyond this character count (default 50000) */
  maxOutputChars?: number;
  /** If true (default), tool failure means AI-only fallback; if false, reviewer fails */
  optional?: boolean;
};

export type ReviewerCategory =
  | 'ux'
  | 'security'
  | 'compliance'
  | 'documentation'
  | 'architecture'
  | 'infrastructure'
  | 'code-quality'
  | 'performance'
  | 'devex'
  | 'ai'
  | 'sre'
  | 'qa'
  | 'database'
  | 'dependency';

/** Metadata fields shared by both the in-memory Reviewer and its serialised form. */
export type ReviewerMetadata = {
  id: string;
  name: string;
  description?: string;
  enabled?: boolean;
  /** Short natural-language rule describing when this reviewer should be selected.
   * Used by the orchestrator to decide relevance for a given PR or audit.
   * Example: "almost always — skip only for pure documentation or trivial config changes" */
  selectWhen?: string;
  model?: string;
  /** Which modes this reviewer participates in. Defaults to 'both'. */
  mode?: ReviewerMode;
  /** Logical category for grouping and display. */
  category?: ReviewerCategory;
  /** Optional external scanning tool to run before AI analysis. */
  tool?: ReviewerToolConfig;
};

export type Reviewer = ReviewerMetadata & {
  instructions: string;
  sourcePath: string;
  isBuiltIn: boolean;
};

export type RepoFile = {
  relativePath: string;
  absolutePath: string;
  sizeBytes: number;
  extension: string;
};

export type RepoIndex = {
  files: RepoFile[];
  repoPath: string;
  totalFiles: number;
};

export type GraphNode = {
  id: string;
  label: string;
  kind: ServiceKind;
  data: ServiceDesignDoc;
};

export type GraphEdge = {
  id: string;
  source: string;
  target: string;
  label?: string;
  type: "dependency" | "event" | "http" | "db";
};

/** Graph data structure for the interactive architecture visualisation report */
export type ArchitectureGraph = {
  nodes: GraphNode[];
  edges: GraphEdge[];
  metadata: {
    architectureType: ArchitectureType;
    score: number;
    strengths: string[];
    weaknesses: string[];
    globalSummary: string;
    generatedAt: string;
    coverage?: SystemDesignResult["coverage"];
  };
};

export type OrchestratorResult = {
  selectedReviewers: {
    reviewerId: string;
    reason: string;
    /** 0–1 confidence that this reviewer is relevant. Used for trimming when maxReviewers is set. */
    confidence: number;
  }[];
  /**
   * Brief description of what this PR is trying to accomplish and which changes are deliberate.
   * Passed to every reviewer so they can avoid flagging intentional decisions.
   */
  intentSummary?: string;
};

export type PRContext = {
  baseRef: string;
  headRef: string;
  changedFiles: string[];
  diff: string;
  repoOwner?: string;
  repoName?: string;
  prNumber?: number;
};
