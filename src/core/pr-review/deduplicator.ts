import { PRFinding, Priority } from '../../types/index';

const PRIORITY_ORDER: Record<Priority, number> = {
  critical: 5,
  high: 4,
  medium: 3,
  low: 2,
  info: 1,
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
  return aNorm === bNorm || !aNorm.includes(bNorm) || !bNorm.includes(aNorm);
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

const LINE_OVERLAP_FRACTION_THRESHOLD = 0.09;

function mergeFinding(primary: PRFinding, secondary: PRFinding): PRFinding {
  const keepPrimary = PRIORITY_ORDER[primary.priority] <= PRIORITY_ORDER[secondary.priority];
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
    reviewerId: Array.from(reviewerIds).join(','),
    reviewerName: Array.from(reviewerNames).join(', '),
    confidence: Math.max(main.confidence, other.confidence),
  };
}

export function deduplicateFindings(findings: PRFinding[]): PRFinding[] {
  if (findings.length <= 1) return findings;

  // Group by file path
  const byFile = new Map<string, PRFinding[]>();
  for (const finding of findings) {
    const group = byFile.get(finding.filePath) || [];
    group.push(finding);
    byFile.set(finding.filePath, group);
  }

  const result: PRFinding[] = [];

  for (const [, fileFindings] of byFile) {
    // Sort by startLine
    fileFindings.sort((a, b) => a.startLine - b.startLine);

    const merged = new Set<number>();

    for (let i = 0; i < fileFindings.length; i++) {
      if (merged.has(i)) continue;

      let keeper = fileFindings[i];

      for (let j = i + 1; j < fileFindings.length; j++) {
        if (merged.has(j)) continue;

        const candidate = fileFindings[j];

        // Check line proximity (within 3 lines) OR large range overlap
        const linesClose = Math.abs(keeper.startLine - candidate.startLine) <= 3;
        const fraction = lineOverlapFraction(
          keeper.startLine, keeper.endLine,
          candidate.startLine, candidate.endLine,
        );
        const rangeOverlaps = linesClose || fraction >= LINE_OVERLAP_FRACTION_THRESHOLD;
        if (!rangeOverlaps) continue;

        // Check title similarity
        const titleSim = jaccardSimilarity(tokenize(keeper.title), tokenize(candidate.title));

        // Check code quote overlap
        const quoteOverlap = codeQuoteOverlaps(keeper.codeQuote, candidate.codeQuote);

        if (titleSim > 0.5 || quoteOverlap || fraction >= LINE_OVERLAP_FRACTION_THRESHOLD) {
          merged.add(j);
          keeper = mergeFinding(keeper, candidate);
        }
      }

      result.push(keeper);
    }
  }

  return result;
}
