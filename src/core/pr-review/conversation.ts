import { PRFinding } from '../../types/index';
import { ExistingComment } from '../github/types';
import { CODEOWL_COMMENT_MARKER } from '../config/defaults';

export interface PRConversation {
  codeOwlInlineComments: ExistingComment[];
  codeOwlGeneralComments: ExistingComment[];
  allComments: ExistingComment[];
}

function tokenize(text: string): Set<string> {
  return new Set(
    text.toLowerCase().split(/\W+/).filter(t => t.length > 2)
  );
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  const intersection = new Set([...a].filter(x => b.has(x)));
  const union = new Set([...a, ...b]);
  return union.size === 0 ? 0 : intersection.size / union.size;
}

function extractTitleFromComment(body: string): string | null {
  // Extract title from CodeOwl comment format: "**[CodeOwl HIGH] Title**"
  const match = body.match(/\*\*\[CodeOwl [A-Z]+\]\s*(.+?)\*\*/);
  return match ? match[1] : null;
}

export function buildConversation(
  generalComments: ExistingComment[],
  reviewComments: ExistingComment[]
): PRConversation {
  const codeOwlInlineComments = reviewComments.filter(c =>
    c.body.includes(CODEOWL_COMMENT_MARKER)
  );

  const codeOwlGeneralComments = generalComments.filter(c =>
    c.body.includes(CODEOWL_COMMENT_MARKER)
  );

  return {
    codeOwlInlineComments,
    codeOwlGeneralComments,
    allComments: [...generalComments, ...reviewComments],
  };
}

export function filterAlreadyPosted(
  findings: PRFinding[],
  conversation: PRConversation
): PRFinding[] {
  if (conversation.codeOwlInlineComments.length === 0) {
    return findings;
  }

  return findings.filter(finding => {
    // Check each existing CodeOwl inline comment for similarity
    for (const existing of conversation.codeOwlInlineComments) {
      // Same file and line?
      if (existing.path === finding.filePath && existing.line === finding.startLine) {
        return false; // Exact match on file+line, skip
      }

      // Same file, nearby line, and similar title?
      if (existing.path === finding.filePath && existing.line !== undefined) {
        const lineDiff = Math.abs(existing.line - finding.startLine);
        if (lineDiff <= 3) {
          const existingTitle = extractTitleFromComment(existing.body);
          if (existingTitle) {
            const similarity = jaccardSimilarity(
              tokenize(existingTitle),
              tokenize(finding.title)
            );
            if (similarity > 0.5) {
              return false; // Similar finding already posted nearby
            }
          }
        }
      }
    }
    return true;
  });
}
