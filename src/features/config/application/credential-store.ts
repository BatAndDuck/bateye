import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

type RepoCredentialEntry = {
  apiKey: string;
  updatedAt: string;
};

type CredentialStore = {
  repos?: Record<string, RepoCredentialEntry>;
};

export function resolveCredentialStorePath(env: NodeJS.ProcessEnv = process.env): string {
  return env.BATEYE_CREDENTIALS_FILE?.trim() || path.join(os.homedir(), '.bateye', 'credentials.json');
}

function normalizeRepoPath(repoPath: string): string {
  return path.resolve(repoPath);
}

function loadCredentialStore(storePath = resolveCredentialStorePath()): CredentialStore {
  if (!fs.existsSync(storePath)) {
    return { repos: {} };
  }

  try {
    return JSON.parse(fs.readFileSync(storePath, 'utf-8')) as CredentialStore;
  } catch (err) {
    throw new Error(`Failed to parse BatEye credential store ${storePath}: ${(err as Error).message}`, { cause: err });
  }
}

function saveCredentialStore(store: CredentialStore, storePath = resolveCredentialStorePath()): void {
  const dir = path.dirname(storePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(storePath, JSON.stringify(store, null, 2) + '\n', 'utf-8');
}

export function saveRepoApiKey(repoPath: string, apiKey: string, storePath = resolveCredentialStorePath()): void {
  const trimmedApiKey = apiKey.trim();
  if (!trimmedApiKey) {
    throw new Error('API key cannot be empty.');
  }

  const store = loadCredentialStore(storePath);
  const repos = store.repos || {};
  repos[normalizeRepoPath(repoPath)] = {
    apiKey: trimmedApiKey,
    updatedAt: new Date().toISOString(),
  };

  saveCredentialStore({ ...store, repos }, storePath);
}

export function resolveStoredApiKey(repoPath: string, storePath = resolveCredentialStorePath()): string | undefined {
  return loadCredentialStore(storePath).repos?.[normalizeRepoPath(repoPath)]?.apiKey?.trim() || undefined;
}

export function maskApiKey(apiKey: string): string {
  const trimmed = apiKey.trim();
  if (trimmed.length <= 4) {
    return '*'.repeat(trimmed.length);
  }

  return `***${trimmed.slice(-4)}`;
}
