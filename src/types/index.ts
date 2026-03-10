export type Priority = "critical" | "high" | "medium" | "low" | "info";

export type RuntimeType = "sdk" | "cli";

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
  recommendation: string;
  tags?: string[];
};

export type ReviewerResult = {
  reviewerId: string;
  reviewerName: string;
  description?: string;
  score: number;
  summary: string;
  findings: Finding[];
  execution: {
    model: string;
    runtime: RuntimeType;
    durationMs: number;
    scopedFiles: number;
    totalRepoFilesSeen: number;
    warnings?: string[];
  };
};

export type AuditResult = {
  command: "audit";
  repoPath: string;
  overallScore: number;
  summary: string;
  reviewerResults: ReviewerResult[];
  generatedAt: string;
};

export type PRReviewResult = {
  command: "pr-review";
  baseRef: string;
  headRef: string;
  selectedReviewers: {
    reviewerId: string;
    reason: string;
  }[];
  summary: string;
  findings: Finding[];
  generatedAt: string;
};

export type ServiceInterfaceType = "http" | "graphql" | "event" | "queue" | "cron" | "db";

export type ServiceKind = "service" | "module" | "library" | "app" | "worker" | "gateway" | "resource";

export type ResourceCategory =
  | "database"
  | "cache"
  | "queue"
  | "storage"
  | "vector-search"
  | "external-saas"
  | "external-api"
  | "internal-platform";

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
  integrations: {
    name: string;
    description: string;
    internal: boolean;
    category?: ResourceCategory;
  }[];
  dependencies: string[];
  entities: {
    name: string;
    description?: string;
    fields?: string[];
  }[];
  submodules: string[];
  complexityScore: number;
  risks: string[];
};

export type ArchitectureType =
  | "monolith"
  | "modular-monolith"
  | "distributed-monolith"
  | "microservices"
  | "hybrid-service-oriented"
  | "event-driven-hybrid";

export type SystemDesignResult = {
  command: "system-design";
  repoPath: string;
  architectureType: ArchitectureType;
  score: number;
  strengths: string[];
  weaknesses: string[];
  services: ServiceDesignDoc[];
  globalSummary: string;
  artifacts: {
    htmlReportPath: string;
    graphDataPath: string;
    servicesDir: string;
  };
  generatedAt: string;
};

export type Config = {
  $schema?: string;
  model?: string;
  /** Fallback model used when the primary model is rate-limited. API key read from CODE_OWL_LLM_MODEL_API_KEY_FALLBACK. */
  fallbackModel?: string;
  apiKeyEnvVariable?: string;
  exclude?: string[];
};

export type ReviewerMetadata = {
  id: string;
  name: string;
  description?: string;
  enabled?: boolean;
  scopeHints?: string[];
  recommendedGlobs?: string[];
  model?: string;
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
  };
};

export type OrchestratorResult = {
  selectedReviewers: {
    reviewerId: string;
    reason: string;
  }[];
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
