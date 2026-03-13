import * as fs from 'fs';
import * as path from 'path';
import { glob } from 'glob';
import ignore from 'ignore';
import { RepoFile, RepoIndex, Config } from '../../types/index';
import { BUILT_IN_EXCLUDES, MAX_FILE_SIZE_BYTES } from '../config/defaults';

const TEXT_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.py', '.rb', '.go', '.rs', '.java', '.kt', '.scala',
  '.cs', '.cpp', '.c', '.h', '.hpp',
  '.json', '.yaml', '.yml', '.toml', '.xml',
  '.html', '.css', '.scss', '.sass', '.less',
  '.md', '.mdx', '.txt', '.env.example',
  '.sh', '.bash', '.zsh', '.fish',
  '.sql', '.graphql', '.gql',
  '.proto', '.prisma',
  '.tf', '.hcl',
  '.dockerfile', '.Dockerfile',
  '.gitignore', '.editorconfig', '.eslintrc',
]);

function loadGitignore(repoPath: string): ReturnType<typeof ignore> {
  const ig = ignore();
  const gitignorePath = path.join(repoPath, '.gitignore');
  if (fs.existsSync(gitignorePath)) {
    ig.add(fs.readFileSync(gitignorePath, 'utf-8'));
  }
  return ig;
}

function buildExcludePatterns(config: Config): string[] {
  const patterns: string[] = [...BUILT_IN_EXCLUDES];
  if (config.exclude) {
    patterns.push(...config.exclude);
  }
  return patterns;
}

export async function buildRepoIndex(repoPath: string, config: Config): Promise<RepoIndex> {
  const ig = loadGitignore(repoPath);
  const excludePatterns = buildExcludePatterns(config);

  // Build glob ignore list
  const globIgnore = [
    ...BUILT_IN_EXCLUDES.map(e => `**/${e}/**`),
    ...BUILT_IN_EXCLUDES.map(e => `${e}/**`),
    ...(config.exclude || []).map(e => `**/${e}/**`),
    ...(config.exclude || []).map(e => `${e}/**`),
  ];

  const allFiles = await glob('**/*', {
    cwd: repoPath,
    nodir: true,
    ignore: globIgnore,
    dot: false,
  });

  const repoFiles: RepoFile[] = [];

  for (const relPath of allFiles) {
    const normalizedRelPath = relPath.replace(/\\/g, '/');
    // Check gitignore
    if (ig.ignores(normalizedRelPath)) continue;

    const ext = path.extname(normalizedRelPath).toLowerCase();
    if (!TEXT_EXTENSIONS.has(ext) && !normalizedRelPath.includes('Dockerfile')) continue;

    const absPath = path.join(repoPath, relPath);
    try {
      const stat = fs.statSync(absPath);
      if (stat.size > MAX_FILE_SIZE_BYTES) continue;

      repoFiles.push({
        relativePath: normalizedRelPath,
        absolutePath: absPath,
        sizeBytes: stat.size,
        extension: ext,
      });
    } catch {
      // skip unreadable files
    }
  }

  return {
    files: repoFiles,
    repoPath,
    totalFiles: repoFiles.length,
  };
}

export function readFileContent(filePath: string, maxTokens = 8000): string {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    // Rough token estimate: 1 token ≈ 4 chars
    const maxChars = maxTokens * 4;
    if (content.length > maxChars) {
      return content.slice(0, maxChars) + '\n\n[...file truncated...]';
    }
    return content;
  } catch {
    return '';
  }
}

export function scopeFilesForReviewer(
  index: RepoIndex,
  scopeHints: string[] | undefined,
): RepoFile[] {
  const candidates = index.files;

  if (scopeHints && scopeHints.length > 0) {
    // Prioritize files whose paths or names contain scope hints
    const prioritized = candidates.filter(f =>
      scopeHints.some(hint => f.relativePath.toLowerCase().includes(hint.toLowerCase()))
    );
    if (prioritized.length > 0) {
      return prioritized;
    }
  }

  return candidates;
}

export function formatFilesForContext(
  files: RepoFile[],
  maxFiles = 40,
  maxTokensPerFile = 6000
): string {
  const selected = files.slice(0, maxFiles);
  const parts: string[] = [];

  for (const file of selected) {
    const content = readFileContent(file.absolutePath, maxTokensPerFile);
    if (!content) continue;
    parts.push(`=== FILE: ${file.relativePath} ===\n${content}\n`);
  }

  return parts.join('\n');
}
