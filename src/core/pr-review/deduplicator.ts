import { PRFinding, Priority } from '../../types/index';

const PRIORITY_ORDER: Record<Priority, number> = {
  critical: 5,
  high: 4,
  medium: 3,
  low: 2,
  info: 1,
};

const LINE_PROXIMITY_TOLERANCE = 3;
const LINE_OVERLAP_FRACTION_THRESHOLD = 0.9;
const OBVIOUS_DUPLICATE_TITLE_SIMILARITY_THRESHOLD = 0.78;
const AMBIGUOUS_DUPLICATE_TITLE_SIMILARITY_THRESHOLD = 0.2;

export type PRFindingDuplicateCandidate = {
  a: PRFinding;
  b: PRFinding;
  sameAnchor: boolean;
  linesClose: boolean;
  codeQuoteOverlap: boolean;
  lineOverlapFraction: number;
  titleSimilarity: number;
  score: number;
};

export type PRFindingDuplicateDecision = {
  aId: string;
  bId: string;
  verdict: 'duplicate' | 'distinct' | 'unsure';
  confidence: number;
  rationale: string;
  source: 'heuristic' | 'llm';
};

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/\W+/)
      .filter(t => t.length > 2)
  );
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  const intersection = new Set([...a].filter(x => b.has(x)));
  const union = new Set([...a, ...b]);
  return union.size === 0 ? 0 : intersection.size / union.size;
}

function codeQuoteOverlaps(a: string, b: string): boolean {
  if (!a || !b) return false;
  const aNorm = a.trim().toLowerCase();
  const bNorm = b.trim().toLowerCase();
  return aNorm === bNorm || aNorm.includes(bNorm) || bNorm.includes(aNorm);
}

/**
 * Returns the fraction of the shorter line range covered by the overlap.
 * When >= LINE_OVERLAP_FRACTION_THRESHOLD the two findings are essentially
 * pointing at the same block of code, even if their titles differ.
 */
function lineOverlapFraction(s1: number, e1: number, s2: number, e2: number): number {
  const overlapStart = Math.max(s1, s2);
  const overlapEnd = Math.min(e1, e2);
  if (overlapEnd < overlapStart) return 0;
  const overlapLen = overlapEnd - overlapStart + 1;
  const minLen = Math.min(e1 - s1 + 1, e2 - s2 + 1);
  return minLen > 0 ? overlapLen / minLen : 0;
}

function linesClose(a: PRFinding, b: PRFinding): boolean {
  return Math.abs(a.startLine - b.startLine) <= LINE_PROXIMITY_TOLERANCE;
}

function sameAnchor(a: PRFinding, b: PRFinding): boolean {
  return a.startLine === b.startLine && a.endLine === b.endLine;
}

function buildCandidate(a: PRFinding, b: PRFinding): PRFindingDuplicateCandidate {
  const titleSimilarity = jaccardSimilarity(tokenize(a.title), tokenize(b.title));
  const overlapFraction = lineOverlapFraction(a.startLine, a.endLine, b.startLine, b.endLine);
  const quoteOverlap = codeQuoteOverlaps(a.codeQuote, b.codeQuote);
  const close = linesClose(a, b);
  const anchorMatch = sameAnchor(a, b);
  const score = (quoteOverlap ? 4 : 0)
    + (anchorMatch ? 2 : 0)
    + (close ? 1 : 0)
    + (overlapFraction * 3)
    + (titleSimilarity * 2);

  return {
    a,
    b,
    sameAnchor: anchorMatch,
    linesClose: close,
    codeQuoteOverlap: quoteOverlap,
    lineOverlapFraction: overlapFraction,
    titleSimilarity,
    score,
  };
}

function isObviousDuplicate(candidate: PRFindingDuplicateCandidate): boolean {
  const sameBlock = candidate.sameAnchor
    || candidate.codeQuoteOverlap
    || candidate.lineOverlapFraction >= LINE_OVERLAP_FRACTION_THRESHOLD;

  return sameBlock && candidate.titleSimilarity >= OBVIOUS_DUPLICATE_TITLE_SIMILARITY_THRESHOLD;
}

function isAmbiguousDuplicateCandidate(candidate: PRFindingDuplicateCandidate): boolean {
  return candidate.sameAnchor
    || candidate.codeQuoteOverlap
    || candidate.lineOverlapFraction >= LINE_OVERLAP_FRACTION_THRESHOLD
    || (candidate.linesClose && candidate.titleSimilarity >= AMBIGUOUS_DUPLICATE_TITLE_SIMILARITY_THRESHOLD);
}

function mergeFinding(primary: PRFinding, secondary: PRFinding): PRFinding {
  const keepPrimary = PRIORITY_ORDER[primary.priority] >= PRIORITY_ORDER[secondary.priority];
  const main = keepPrimary ? primary : secondary;
  const other = keepPrimary ? secondary : primary;

  // Combine reviewer info if different reviewers; filter empty tokens that arise
  // when reviewerId/reviewerName is an empty string (split yields [''])
  const splitTrim = (s: string, sep: string) => s.split(sep).map(t => t.trim()).filter(Boolean);
  const reviewerIds = new Set([...splitTrim(main.reviewerId, ','), ...splitTrim(other.reviewerId, ',')]);
  const reviewerNames = new Set([...splitTrim(main.reviewerName, ', '), ...splitTrim(other.reviewerName, ', ')]);

  return {
    ...main,
    evidence: [...new Set([...main.evidence, ...other.evidence])],
    verificationTrail: [...new Set([...main.verificationTrail, ...other.verificationTrail])],
    searchedFor: [...new Set([...(main.searchedFor || []), ...(other.searchedFor || [])])],
    tags: [...new Set([...(main.tags || []), ...(other.tags || [])])],
    reviewerId: Array.from(reviewerIds).join(','),
    reviewerName: Array.from(reviewerNames).join(', '),
    confidence: Math.max(main.confidence, other.confidence),
  };
}

export function buildFindingDedupPlan(findings: PRFinding[]): {
  obviousDecisions: PRFindingDuplicateDecision[];
  ambiguousCandidates: PRFindingDuplicateCandidate[];
} {
  if (findings.length <= 1) {
    return {
      obviousDecisions: [],
      ambiguousCandidates: [],
    };
  }

  // Group by file path
  const byFile = new Map<string, PRFinding[]>();
  for (const finding of findings) {
    const group = byFile.get(finding.filePath) || [];
    group.push(finding);
    byFile.set(finding.filePath, group);
  }

  const obviousDecisions: PRFindingDuplicateDecision[] = [];
  const ambiguousCandidates: PRFindingDuplicateCandidate[] = [];

  for (const [, fileFindings] of byFile) {
    // Sort by startLine
    fileFindings.sort((a, b) => a.startLine - b.startLine);

    for (let i = 0; i < fileFindings.length; i++) {
      for (let j = i + 1; j < fileFindings.length; j++) {
        const candidate = buildCandidate(fileFindings[i], fileFindings[j]);
        if (!isAmbiguousDuplicateCandidate(candidate)) continue;

        if (isObviousDuplicate(candidate)) {
          obviousDecisions.push({
            aId: candidate.a.id,
            bId: candidate.b.id,
            verdict: 'duplicate',
            confidence: 0.98,
            rationale: 'Same file/block with highly similar titles and overlapping evidence.',
            source: 'heuristic',
          });
        } else {
          ambiguousCandidates.push(candidate);
        }
      }
    }
  }

  ambiguousCandidates.sort((a, b) => b.score - a.score);

  return {
    obviousDecisions,
    ambiguousCandidates,
  };
}

export function mergeDuplicateFindings(
  findings: PRFinding[],
  decisions: PRFindingDuplicateDecision[],
): PRFinding[] {
  if (findings.length <= 1) {
    return findings;
  }

  const findingById = new Map(findings.map(finding => [finding.id, finding]));
  const parent = new Map(findings.map(finding => [finding.id, finding.id]));
  const originalIndex = new Map(findings.map((finding, index) => [finding.id, index]));

  function find(id: string): string {
    const current = parent.get(id) || id;
    if (current === id) {
      return id;
    }

    const root = find(current);
    parent.set(id, root);
    return root;
  }

  function union(aId: string, bId: string): void {
    const rootA = find(aId);
    const rootB = find(bId);
    if (rootA === rootB) {
      return;
    }

    parent.set(rootB, rootA);
  }

  for (const decision of decisions) {
    if (decision.verdict !== 'duplicate') {
      continue;
    }

    if (!findingById.has(decision.aId) || !findingById.has(decision.bId)) {
      continue;
    }

    union(decision.aId, decision.bId);
  }

  const groups = new Map<string, PRFinding[]>();
  for (const finding of findings) {
    const root = find(finding.id);
    const group = groups.get(root) || [];
    group.push(finding);
    groups.set(root, group);
  }

  const merged: Array<{ finding: PRFinding; index: number }> = [];
  for (const group of groups.values()) {
    const sorted = [...group].sort((a, b) => {
      const priorityDiff = (PRIORITY_ORDER[b.priority] ?? 0) - (PRIORITY_ORDER[a.priority] ?? 0);
      if (priorityDiff !== 0) return priorityDiff;
      if (b.confidence !== a.confidence) return b.confidence - a.confidence;
      if (a.startLine !== b.startLine) return a.startLine - b.startLine;
      return a.id.localeCompare(b.id);
    });

    const groupFinding = sorted.reduce((acc, finding) => mergeFinding(acc, finding));
    const minIndex = Math.min(...group.map(item => originalIndex.get(item.id) ?? Number.MAX_SAFE_INTEGER));
    merged.push({ finding: groupFinding, index: minIndex });
  }

  return merged
    .sort((a, b) => a.index - b.index)
    .map(item => item.finding);
}

export function deduplicateFindings(findings: PRFinding[]): PRFinding[] {
  const plan = buildFindingDedupPlan(findings);
  return mergeDuplicateFindings(findings, plan.obviousDecisions);
}
