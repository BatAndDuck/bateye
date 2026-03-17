import * as fs from 'fs';
import * as path from 'path';
import { glob } from 'glob';
import ignore from 'ignore';
import { RepoFile, RepoIndex, Config, Reviewer } from '../../types/index';
import { BUILT_IN_EXCLUDES, MAX_FILE_SIZE_BYTES, MAX_FILES_FOR_REVIEWER_CONTEXT } from '../config/defaults';

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

const INTERNAL_ANALYSIS_EXCLUDES = [
  'src/features/audit/builtin-reviewers',
  'dist/features/audit/builtin-reviewers',
];

function loadGitignore(repoPath: string): ReturnType<typeof ignore> {
  const ig = ignore();
  const gitignorePath = path.join(repoPath, '.gitignore');
  if (fs.existsSync(gitignorePath)) {
    ig.add(fs.readFileSync(gitignorePath, 'utf-8'));
  }
  return ig;
}

export async function buildRepoIndex(repoPath: string, config: Config): Promise<RepoIndex> {
  const ig = loadGitignore(repoPath);
  const internalIgnore = buildInternalAnalysisIgnores(repoPath);

  // Build glob ignore list
  const globIgnore = [
    ...BUILT_IN_EXCLUDES.map(e => `**/${e}/**`),
    ...BUILT_IN_EXCLUDES.map(e => `${e}/**`),
    ...(config.exclude || []).map(e => `**/${e}/**`),
    ...(config.exclude || []).map(e => `${e}/**`),
    ...internalIgnore,
  ];

  const allFiles = (await glob('**/*', {
    cwd: repoPath,
    nodir: true,
    ignore: globIgnore,
    dot: false,
  })).sort((a, b) => a.localeCompare(b));

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

function buildInternalAnalysisIgnores(repoPath: string): string[] {
  return INTERNAL_ANALYSIS_EXCLUDES
    .filter(relativeDir => fs.existsSync(path.join(repoPath, ...relativeDir.split('/'))))
    .flatMap(relativeDir => [`${relativeDir}/**`, `**/${relativeDir}/**`]);
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

type AuditSeedReviewer = Pick<Reviewer, 'category' | 'scopeHints' | 'tool'>;

export function calculateAuditSeedFileBudget(
  index: RepoIndex,
  reviewer: AuditSeedReviewer,
  scopedFiles: RepoFile[],
): number {
  if (scopedFiles.length === 0) return 0;

  let budget = baseAuditSeedBudget(index.totalFiles);
  const scopeRatio = scopedFiles.length / Math.max(index.totalFiles, 1);

  if (!reviewer.scopeHints?.length) {
    budget += 4;
  }

  if (reviewer.category && ['architecture', 'code-quality', 'performance', 'qa', 'security'].includes(reviewer.category)) {
    budget += 2;
  }

  if (scopeRatio >= 0.75) {
    budget -= 4;
  } else if (scopeRatio >= 0.4) {
    budget -= 2;
  } else if (scopeRatio > 0 && scopeRatio <= 0.15) {
    budget += 2;
  }

  if (reviewer.tool) {
    budget = Math.min(budget, 12);
  }

  const cappedMax = Math.min(MAX_FILES_FOR_REVIEWER_CONTEXT, scopedFiles.length);
  if (cappedMax <= 0) return 0;

  return Math.min(cappedMax, Math.max(1, budget));
}

export function selectAuditSeedFiles(
  index: RepoIndex,
  reviewer: AuditSeedReviewer,
  scopedFiles: RepoFile[],
): RepoFile[] {
  const budget = calculateAuditSeedFileBudget(index, reviewer, scopedFiles);
  if (budget === 0) return [];

  return [...scopedFiles]
    .sort((a, b) => {
      const scoreDiff = scoreAuditSeedFile(b, reviewer) - scoreAuditSeedFile(a, reviewer);
      if (scoreDiff !== 0) return scoreDiff;
      return a.relativePath.localeCompare(b.relativePath);
    })
    .slice(0, budget);
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

function baseAuditSeedBudget(totalFiles: number): number {
  if (totalFiles <= 20) return 6;
  if (totalFiles <= 50) return 8;
  if (totalFiles <= 120) return 12;
  if (totalFiles <= 300) return 16;
  if (totalFiles <= 700) return 20;
  if (totalFiles <= 1500) return 24;
  return 28;
}

function scoreAuditSeedFile(file: RepoFile, reviewer: AuditSeedReviewer): number {
  const normalizedPath = file.relativePath.toLowerCase();
  let score = 0;

  score += countScopeHintMatches(normalizedPath, reviewer.scopeHints) * 40;

  if (isLikelyConfigFile(normalizedPath)) score += 25;
  if (isLikelyEntryPoint(normalizedPath)) score += 18;
  if (normalizedPath.startsWith('src/')) score += 10;
  if (isTestFile(normalizedPath)) score += 8;

  score += categorySpecificSeedScore(normalizedPath, reviewer.category);
  score -= normalizedPath.split('/').length - 1;

  return score;
}

function countScopeHintMatches(filePath: string, scopeHints: string[] | undefined): number {
  if (!scopeHints?.length) return 0;
  return scopeHints.reduce((count, hint) => count + (filePath.includes(hint.toLowerCase()) ? 1 : 0), 0);
}

function isLikelyConfigFile(filePath: string): boolean {
  return [
    'package.json',
    'package-lock.json',
    'pnpm-lock.yaml',
    'yarn.lock',
    'tsconfig.json',
    'tsconfig.base.json',
    'vite.config.ts',
    'vite.config.js',
    'webpack.config.js',
    'webpack.config.ts',
    'rollup.config.js',
    'rollup.config.ts',
    'next.config.js',
    'next.config.mjs',
    'eslint.config.js',
    'eslint.config.mjs',
    'dockerfile',
    '.github/workflows',
  ].some(candidate => filePath === candidate || filePath.includes(candidate));
}

function isLikelyEntryPoint(filePath: string): boolean {
  return /(src\/)?(index|main|app|server|client|router|routes|page|layout)\.(ts|tsx|js|jsx|mjs|cjs|html)$/.test(filePath)
    || /\/(index|main|app|server|client|router|routes|page|layout)\.(ts|tsx|js|jsx|mjs|cjs|html)$/.test(filePath);
}

function isTestFile(filePath: string): boolean {
  return filePath.startsWith('test/')
    || filePath.startsWith('tests/')
    || filePath.includes('.test.')
    || filePath.includes('.spec.');
}

function categorySpecificSeedScore(filePath: string, category: Reviewer['category'] | undefined): number {
  switch (category) {
    case 'documentation':
      if (filePath === 'readme.md' || filePath.startsWith('docs/')) return 45;
      if (filePath.endsWith('.md') || filePath.endsWith('.mdx')) return 30;
      return 0;
    case 'qa':
      if (isTestFile(filePath)) return 45;
      if (filePath.startsWith('src/')) return 12;
      return 0;
    case 'performance':
    case 'ux':
      if (/(vite|webpack|rollup|next)\.config\.(ts|js|mjs|cjs)$/.test(filePath)) return 70;
      if (/\.(tsx|jsx|html|css|scss|sass|less|vue|svelte)$/.test(filePath)) return 40;
      if (/\/(component|components|page|pages|layout|layouts|client|browser)\//.test(filePath)) return 25;
      return 0;
    case 'security':
    case 'dependency':
      if (isLikelyConfigFile(filePath)) return 35;
      if (filePath.startsWith('src/')) return 15;
      return 0;
    case 'architecture':
    case 'code-quality':
      if (filePath.startsWith('src/')) return 22;
      if (isLikelyConfigFile(filePath)) return 16;
      return 0;
    case 'infrastructure':
    case 'sre':
      if (isLikelyConfigFile(filePath) || /\.(tf|hcl|ya?ml)$/.test(filePath)) return 40;
      return 0;
    default:
      if (filePath.startsWith('src/')) return 12;
      return 0;
  }
}
