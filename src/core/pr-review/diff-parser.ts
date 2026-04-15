export interface DiffLine {
  type: 'add' | 'remove' | 'context';
  content: string;
  oldLineNumber: number | null;
  newLineNumber: number | null;
}

export interface DiffHunk {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  lines: DiffLine[];
}

export interface FileDiff {
  filePath: string;
  hunks: DiffHunk[];
  addedLines: Map<number, string>;
  removedLines: Map<number, string>;
  changedNewLineNumbers: Set<number>;
}

export interface ParsedDiff {
  files: Map<string, FileDiff>;
}

export function parseUnifiedDiff(rawDiff: string): ParsedDiff {
  const files = new Map<string, FileDiff>();
  if (!rawDiff.trim()) return { files };

  // Split by diff headers
  const fileBlocks = rawDiff.split(/^diff --git /m);

  for (const block of fileBlocks) {
    if (!block.trim()) continue;

    // Extract file path from +++ line
    const plusMatch = block.match(/^\+\+\+ b\/(.+)$/m);
    if (!plusMatch) continue;

    const filePath = plusMatch[1].trim();
    if (filePath === '/dev/null') continue;

    const addedLines = new Map<number, string>();
    const removedLines = new Map<number, string>();
    const changedNewLineNumbers = new Set<number>();
    const hunks: DiffHunk[] = [];

    // Find all hunks
    const hunkRegex = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@.*$/gm;
    let hunkMatch: RegExpExecArray | null;
    const hunkStarts: { index: number; oldStart: number; oldCount: number; newStart: number; newCount: number }[] = [];

    while ((hunkMatch = hunkRegex.exec(block)) !== null) {
      hunkStarts.push({
        index: hunkMatch.index + hunkMatch[0].length,
        oldStart: parseInt(hunkMatch[1], 10),
        oldCount: hunkMatch[2] !== undefined ? parseInt(hunkMatch[2], 10) : 1,
        newStart: parseInt(hunkMatch[3], 10),
        newCount: hunkMatch[4] !== undefined ? parseInt(hunkMatch[4], 10) : 1,
      });
    }

    for (let h = 0; h < hunkStarts.length; h++) {
      const hunkInfo = hunkStarts[h];
      const startIdx = hunkInfo.index;

      // Get the text between this hunk header and the next
      const hunkBody = block.slice(startIdx, h + 1 < hunkStarts.length ? block.indexOf('\n@@ ', startIdx + 1) : block.length);
      const rawLines = hunkBody.split('\n');

      let oldLine = hunkInfo.oldStart;
      let newLine = hunkInfo.newStart;
      const hunkLines: DiffLine[] = [];

      for (const rawLine of rawLines) {
        if (rawLine === '') continue;

        const prefix = rawLine[0];

        if (prefix === '+') {
          const content = rawLine.slice(1);
          hunkLines.push({ type: 'add', content, oldLineNumber: null, newLineNumber: newLine });
          addedLines.set(newLine, content);
          changedNewLineNumbers.add(newLine);
          newLine++;
        } else if (prefix === '-') {
          const content = rawLine.slice(1);
          hunkLines.push({ type: 'remove', content, oldLineNumber: oldLine, newLineNumber: null });
          removedLines.set(oldLine, content);
          oldLine++;
        } else if (prefix === ' ') {
          const content = rawLine.slice(1);
          hunkLines.push({ type: 'context', content, oldLineNumber: oldLine, newLineNumber: newLine });
          oldLine++;
          newLine++;
        } else if (prefix === '\\') {
          // "\ No newline at end of file" - skip
          continue;
        }
      }

      hunks.push({
        oldStart: hunkInfo.oldStart,
        oldCount: hunkInfo.oldCount,
        newStart: hunkInfo.newStart,
        newCount: hunkInfo.newCount,
        lines: hunkLines,
      });
    }

    files.set(filePath, { filePath, hunks, addedLines, removedLines, changedNewLineNumbers });
  }

  return { files };
}

export function isLineInDiff(parsed: ParsedDiff, filePath: string, line: number): boolean {
  const fileDiff = parsed.files.get(filePath);
  if (!fileDiff) return false;
  return fileDiff.changedNewLineNumbers.has(line);
}

export function isLineNearDiff(parsed: ParsedDiff, filePath: string, line: number, tolerance: number = 3): boolean {
  const fileDiff = parsed.files.get(filePath);
  if (!fileDiff) return false;
  for (let offset = -tolerance; offset <= tolerance; offset++) {
    if (fileDiff.changedNewLineNumbers.has(line + offset)) return true;
  }
  // Also check if line falls within any hunk's range (including context lines)
  for (const hunk of fileDiff.hunks) {
    const hunkEnd = hunk.newStart + hunk.newCount - 1;
    if (line >= hunk.newStart && line <= hunkEnd) return true;
  }
  return false;
}

export function getCodeAtLine(parsed: ParsedDiff, filePath: string, line: number): string | null {
  const fileDiff = parsed.files.get(filePath);
  if (!fileDiff) return null;

  for (const hunk of fileDiff.hunks) {
    for (const diffLine of hunk.lines) {
      if (diffLine.newLineNumber === line) {
        return diffLine.content;
      }
    }
  }
  return null;
}

function resolveDiffEntries(parsed: ParsedDiff, selectedFiles?: string[]): Array<[string, FileDiff]> {
  if (!selectedFiles || selectedFiles.length === 0) {
    return Array.from(parsed.files.entries());
  }

  return selectedFiles
    .map(filePath => {
      const fileDiff = parsed.files.get(filePath);
      return fileDiff ? [filePath, fileDiff] as [string, FileDiff] : null;
    })
    .filter((entry): entry is [string, FileDiff] => entry !== null);
}

export function buildReviewerDiffContext(parsed: ParsedDiff, selectedFiles?: string[]): string {
  const sections: string[] = [];

  for (const [filePath, fileDiff] of resolveDiffEntries(parsed, selectedFiles)) {
    const lines: string[] = [];
    lines.push(`=== FILE: ${filePath} ===`);

    for (const hunk of fileDiff.hunks) {
      for (const line of hunk.lines) {
        if (line.type === 'add') {
          lines.push(`[Line ${line.newLineNumber}] + ${line.content}`);
        } else if (line.type === 'remove') {
          lines.push(`[Removed]  - ${line.content}`);
        } else {
          lines.push(`[Line ${line.newLineNumber}]   ${line.content}`);
        }
      }
    }

    sections.push(lines.join('\n'));
  }

  return sections.join('\n\n');
}

export function getFilesInDiff(parsed: ParsedDiff, selectedFiles?: string[]): string[] {
  return resolveDiffEntries(parsed, selectedFiles).map(([filePath]) => filePath);
}

export function getChangedLineContent(parsed: ParsedDiff, filePath: string): string[] {
  const fileDiff = parsed.files.get(filePath);
  if (!fileDiff) return [];

  const content: string[] = [];
  for (const hunk of fileDiff.hunks) {
    for (const line of hunk.lines) {
      content.push(line.content);
    }
  }
  return content;
}
