import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { z } from 'zod';

type RepoCredentialEntry = {
  apiKey: string;
  updatedAt: string;
};

type CredentialStore = {
  repos?: Record<string, RepoCredentialEntry>;
};

const repoCredentialEntrySchema = z.object({
  apiKey: z.string().trim().min(1),
  updatedAt: z.string().trim().min(1),
});

const credentialStoreRootSchema = z.object({
  repos: z.record(z.unknown()).optional(),
});

const LOCK_RETRY_DELAY_MS = 25;
const LOCK_TIMEOUT_MS = 5_000;
const LOCK_STALE_MS = 30_000;
const CREDENTIAL_DIR_MODE = 0o700;
const CREDENTIAL_FILE_MODE = 0o600;

export function resolveCredentialStorePath(env: NodeJS.ProcessEnv = process.env): string {
  return env.BATEYE_CREDENTIALS_FILE?.trim() || path.join(os.homedir(), '.bateye', 'credentials.json');
}

function normalizeRepoPath(repoPath: string): string {
  return path.resolve(repoPath);
}

function parseCredentialStore(raw: unknown, storePath: string): CredentialStore {
  const parsed = credentialStoreRootSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`Invalid credential store structure in ${storePath}.`);
  }

  const repos = Object.fromEntries(
    Object.entries(parsed.data.repos || {}).flatMap(([repoPath, entry]) => {
      const repoEntry = repoCredentialEntrySchema.safeParse(entry);
      return repoEntry.success ? [[repoPath, repoEntry.data]] : [];
    }),
  );

  return { repos };
}

function loadCredentialStore(storePath = resolveCredentialStorePath()): CredentialStore {
  if (!fs.existsSync(storePath)) {
    return { repos: {} };
  }

  try {
    return parseCredentialStore(JSON.parse(fs.readFileSync(storePath, 'utf-8')) as unknown, storePath);
  } catch (err) {
    throw new Error(`Failed to parse BatEye credential store ${storePath}: ${(err as Error).message}`, { cause: err });
  }
}

function sleepSync(ms: number): void {
  const sab = new SharedArrayBuffer(4);
  const int32 = new Int32Array(sab);
  Atomics.wait(int32, 0, 0, ms);
}

function resolveCredentialLockPath(storePath: string): string {
  return `${storePath}.lock`;
}

function ensureCredentialStoreDir(storePath: string): void {
  const dir = path.dirname(storePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: CREDENTIAL_DIR_MODE });
  }

  fs.chmodSync(dir, CREDENTIAL_DIR_MODE);
}

function acquireCredentialStoreLock(lockPath: string): number {
  const start = Date.now();

  while (true) {
    try {
      return fs.openSync(lockPath, 'wx', CREDENTIAL_FILE_MODE);
    } catch (err) {
      const error = err as NodeJS.ErrnoException;
      if (error.code !== 'EEXIST') {
        throw error;
      }

      try {
        const stat = fs.statSync(lockPath);
        if (Date.now() - stat.mtimeMs > LOCK_STALE_MS) {
          fs.rmSync(lockPath, { force: true });
          continue;
        }
      } catch (statErr) {
        const statError = statErr as NodeJS.ErrnoException;
        if (statError.code === 'ENOENT') {
          continue;
        }
        throw statError;
      }

      if (Date.now() - start > LOCK_TIMEOUT_MS) {
        throw new Error(`Timed out waiting for BatEye credential store lock: ${lockPath}`, { cause: err });
      }

      sleepSync(LOCK_RETRY_DELAY_MS);
    }
  }
}

function releaseCredentialStoreLock(lockFd: number, lockPath: string): void {
  fs.closeSync(lockFd);
  fs.rmSync(lockPath, { force: true });
}

function saveCredentialStore(store: CredentialStore, storePath = resolveCredentialStorePath()): void {
  ensureCredentialStoreDir(storePath);
  const tempPath = `${storePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(store, null, 2) + '\n', {
    encoding: 'utf-8',
    mode: CREDENTIAL_FILE_MODE,
  });
  fs.renameSync(tempPath, storePath);
  fs.chmodSync(storePath, CREDENTIAL_FILE_MODE);
}

export function saveRepoApiKey(repoPath: string, apiKey: string, storePath = resolveCredentialStorePath()): void {
  const trimmedApiKey = apiKey.trim();
  if (!trimmedApiKey) {
    throw new Error('API key cannot be empty.');
  }

  ensureCredentialStoreDir(storePath);
  const lockPath = resolveCredentialLockPath(storePath);
  const lockFd = acquireCredentialStoreLock(lockPath);

  try {
    const store = loadCredentialStore(storePath);
    const repos = store.repos || {};
    repos[normalizeRepoPath(repoPath)] = {
      apiKey: trimmedApiKey,
      updatedAt: new Date().toISOString(),
    };

    saveCredentialStore({ ...store, repos }, storePath);
  } finally {
    releaseCredentialStoreLock(lockFd, lockPath);
  }
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
