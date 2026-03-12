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
  return aNorm === bNorm || aNorm.includes(bNorm) || bNorm.includes(aNorm);
}

function mergeFinding(primary: PRFinding, secondary: PRFinding): PRFinding {
  const keepPrimary = PRIORITY_ORDER[primary.priority] >= PRIORITY_ORDER[secondary.priority];
  const main = keepPrimary ? primary : secondary;
  const other = keepPrimary ? secondary : primary;

  // Combine reviewer info if different reviewers
  const reviewerIds = new Set(main.reviewerId.split(',').concat(other.reviewerId.split(',')));
  const reviewerNames = new Set(main.reviewerName.split(', ').concat(other.reviewerName.split(', ')));

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

        // Check line proximity (within 3 lines)
        const linesClose = Math.abs(keeper.startLine - candidate.startLine) <= 3;
        if (!linesClose) continue;

        // Check title similarity
        const titleSim = jaccardSimilarity(tokenize(keeper.title), tokenize(candidate.title));

        // Check code quote overlap
        const quoteOverlap = codeQuoteOverlaps(keeper.codeQuote, candidate.codeQuote);

        if (titleSim > 0.5 || quoteOverlap) {
          merged.add(j);
          keeper = mergeFinding(keeper, candidate);
        }
      }

      result.push(keeper);
    }
  }

  return result;
}
