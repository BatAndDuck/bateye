import { PRFinding } from '../../types/index';
import { ExistingComment } from '../github/types';
import { BATEYE_COMMENT_MARKER } from '../config/defaults';

export interface PRConversation {
  batEyeInlineComments: ExistingComment[];
  batEyeGeneralComments: ExistingComment[];
  allComments: ExistingComment[];
}

function tokenize(text: string): Set<string> {
  return new Set(
    text.toLowerCase().split(/\W+/).filter(t => t.length > 2)
  );
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  if (a.size === 0 || b.size === 0) return 0;
  const intersection = new Set([...a].filter(x => b.has(x)));
  const union = new Set([...a, ...b]);
  return union.size === 0 ? 0 : intersection.size / union.size;
}

/**
 * Extract ALL BatEye finding titles from a comment body.
 * A comment may contain multiple titles (e.g. the summary comment lists every finding).
 * Format matched: **[BatEye SEVERITY] Title text**
 */
function extractAllTitles(body: string): string[] {
  const titles: string[] = [];
  const regex = /\*\*\[BatEye [A-Z]+\]\s*(.+?)\*\*/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(body)) !== null) {
    titles.push(match[1]);
  }
  return titles;
}

export function buildConversation(
  generalComments: ExistingComment[],
  reviewComments: ExistingComment[]
): PRConversation {
  const batEyeInlineComments = reviewComments.filter(c =>
    c.body.includes(BATEYE_COMMENT_MARKER)
  );

  const batEyeGeneralComments = generalComments.filter(c =>
    c.body.includes(BATEYE_COMMENT_MARKER)
  );

  return {
    batEyeInlineComments,
    batEyeGeneralComments,
    allComments: [...generalComments, ...reviewComments],
  };
}

/**
 * Deduplication thresholds.
 *
 * GLOBAL_TITLE_THRESHOLD - title Jaccard similarity required to consider two findings
 *   identical regardless of which file or line they reference. High value (0.7) to avoid
 *   matching legitimately distinct findings that share common words.
 *
 * LOCAL_TITLE_THRESHOLD - lower threshold used when the finding is on the same file AND
 *   within NEARBY_LINE_RANGE lines of an existing comment. The additional location context
 *   allows a softer title match.
 */
const GLOBAL_TITLE_THRESHOLD = 0.7;
const LOCAL_TITLE_THRESHOLD = 0.5;
const NEARBY_LINE_RANGE = 5;

interface PrecomputedComment {
  comment: ExistingComment;
  /** All BatEye finding titles found in this comment body (tokenized). */
  titleTokenSets: Set<string>[];
}

export function filterAlreadyPosted(
  findings: PRFinding[],
  conversation: PRConversation
): PRFinding[] {
  // Check both inline review comments (resolved or unresolved) AND general PR comments
  // (e.g. the summary comment that lists all findings from a previous run).
  const allBatEyeComments: ExistingComment[] = [
    ...conversation.batEyeInlineComments,
    ...conversation.batEyeGeneralComments,
  ];

  if (allBatEyeComments.length === 0) {
    return findings;
  }

  // Pre-compute tokenized title sets for every existing BatEye comment.
  // A single comment may contain multiple titles (e.g. the summary); we extract all of them.
  const precomputed: PrecomputedComment[] = allBatEyeComments.map(comment => ({
    comment,
    titleTokenSets: extractAllTitles(comment.body).map(tokenize).filter(s => s.size > 0),
  }));

  return findings.filter(finding => {
    const findingTitleTokens = tokenize(finding.title);

    for (const { comment, titleTokenSets } of precomputed) {
      // ── Gate 1: Exact file + line match ──────────────────────────────────────
      // An existing inline comment on the exact same location means the finding
      // was already posted (regardless of resolution state).
      if (comment.path === finding.filePath && comment.line === finding.startLine) {
        return true;
      }

      for (const existingTitleTokens of titleTokenSets) {
        const titleSim = jaccardSimilarity(existingTitleTokens, findingTitleTokens);

        // ── Gate 2: Global title similarity ──────────────────────────────────
        // If this title was already posted anywhere in the PR (different file,
        // different line, or even in the summary), treat it as a duplicate.
        // A high threshold avoids suppressing genuinely distinct findings that
        // share common terminology.
        if (titleSim >= GLOBAL_TITLE_THRESHOLD) {
          return false;
        }

        // ── Gate 3: Same file + nearby line + lower title similarity ──────────
        // When the diff changed (PR update) and the finding shifted a few lines,
        // a softer title match combined with location proximity is enough to
        // identify it as the same underlying issue.
        if (
          comment.path === finding.filePath &&
          comment.line !== undefined &&
          Math.abs(comment.line - finding.startLine) <= NEARBY_LINE_RANGE &&
          titleSim >= LOCAL_TITLE_THRESHOLD
        ) {
          return false;
        }
      }
    }

    return true;
  });
}
