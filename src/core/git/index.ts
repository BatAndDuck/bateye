import execa from 'execa';
import * as path from 'path';
import * as fs from 'fs';

export async function isGitRepo(repoPath: string): Promise<boolean> {
  return fs.existsSync(path.join(repoPath, '.git'));
}

export async function getGitDiff(repoPath: string, baseRef: string, headRef: string): Promise<string> {
  const result = await execa('git', ['diff', `${baseRef}...${headRef}`, '--unified=5'], {
    cwd: repoPath,
  });
  return result.stdout;
}

export async function getChangedFiles(repoPath: string, baseRef: string, headRef: string): Promise<string[]> {
  const result = await execa('git', ['diff', '--name-only', `${baseRef}...${headRef}`], {
    cwd: repoPath,
  });
  return result.stdout.split('\n').filter(Boolean);
}

async function getRemoteUrl(repoPath: string): Promise<string | null> {
  try {
    const result = await execa('git', ['remote', 'get-url', 'origin'], {
      cwd: repoPath,
    });
    return result.stdout.trim();
  } catch {
    return null;
  }
}

export function parseGithubRepoFromUrl(url: string): { owner: string; repo: string } | null {
  // Match https://github.com/owner/repo.git or git@github.com:owner/repo.git
  const httpsMatch = url.match(/github\.com[/:]([\w.-]+)\/([\w.-]+?)(?:\.git)?$/);
  if (httpsMatch) {
    return { owner: httpsMatch[1], repo: httpsMatch[2] };
  }
  return null;
}

export async function getRepoOwnerAndName(repoPath: string): Promise<{ owner: string; repo: string } | null> {
  const remoteUrl = await getRemoteUrl(repoPath);
  if (!remoteUrl) return null;
  return parseGithubRepoFromUrl(remoteUrl);
}

export async function listTopLevelDirs(repoPath: string): Promise<string[]> {
  return fs.readdirSync(repoPath).filter(entry => {
    const fullPath = path.join(repoPath, entry);
    return fs.statSync(fullPath).isDirectory() && !entry.startsWith('.');
  });
}
