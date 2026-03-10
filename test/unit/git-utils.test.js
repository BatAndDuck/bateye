const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  isGitRepo,
  parseGithubRepoFromUrl,
  listTopLevelDirs,
} = require('../../dist/core/git/index');

// isGitRepo
test('isGitRepo returns true when .git directory exists', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codeowl-git-'));
  fs.mkdirSync(path.join(tmpDir, '.git'));
  assert.equal(await isGitRepo(tmpDir), true);
});

test('isGitRepo returns false when .git directory is absent', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codeowl-git-'));
  assert.equal(await isGitRepo(tmpDir), false);
});

test('isGitRepo returns false for non-existent path', async () => {
  assert.equal(await isGitRepo('/tmp/nonexistent-codeowl-xyz'), false);
});

// parseGithubRepoFromUrl
test('parseGithubRepoFromUrl parses HTTPS URL without .git suffix', () => {
  const result = parseGithubRepoFromUrl('https://github.com/owner/my-repo');
  assert.deepEqual(result, { owner: 'owner', repo: 'my-repo' });
});

test('parseGithubRepoFromUrl parses HTTPS URL with .git suffix', () => {
  const result = parseGithubRepoFromUrl('https://github.com/owner/my-repo.git');
  assert.deepEqual(result, { owner: 'owner', repo: 'my-repo' });
});

test('parseGithubRepoFromUrl parses SSH URL', () => {
  const result = parseGithubRepoFromUrl('git@github.com:owner/my-repo.git');
  assert.deepEqual(result, { owner: 'owner', repo: 'my-repo' });
});

test('parseGithubRepoFromUrl parses SSH URL without .git suffix', () => {
  const result = parseGithubRepoFromUrl('git@github.com:owner/my-repo');
  assert.deepEqual(result, { owner: 'owner', repo: 'my-repo' });
});

test('parseGithubRepoFromUrl handles org with dashes and dots', () => {
  const result = parseGithubRepoFromUrl('https://github.com/my-org.io/cool.project.git');
  assert.deepEqual(result, { owner: 'my-org.io', repo: 'cool.project' });
});

test('parseGithubRepoFromUrl returns null for non-GitHub URLs', () => {
  assert.equal(parseGithubRepoFromUrl('https://gitlab.com/owner/repo'), null);
  assert.equal(parseGithubRepoFromUrl('https://bitbucket.org/owner/repo.git'), null);
});

test('parseGithubRepoFromUrl returns null for empty string', () => {
  assert.equal(parseGithubRepoFromUrl(''), null);
});

test('parseGithubRepoFromUrl returns null for plain text', () => {
  assert.equal(parseGithubRepoFromUrl('not-a-url'), null);
});

// listTopLevelDirs
test('listTopLevelDirs returns non-hidden subdirectories only', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codeowl-git-'));
  fs.mkdirSync(path.join(tmpDir, 'src'));
  fs.mkdirSync(path.join(tmpDir, 'test'));
  fs.mkdirSync(path.join(tmpDir, '.hidden'));
  fs.writeFileSync(path.join(tmpDir, 'README.md'), '');

  const dirs = await listTopLevelDirs(tmpDir);
  assert.ok(dirs.includes('src'));
  assert.ok(dirs.includes('test'));
  assert.ok(!dirs.includes('.hidden'));
  assert.ok(!dirs.includes('README.md'));
});

test('listTopLevelDirs returns empty array when no subdirectories exist', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codeowl-git-'));
  fs.writeFileSync(path.join(tmpDir, 'file.txt'), '');
  const dirs = await listTopLevelDirs(tmpDir);
  assert.deepEqual(dirs, []);
});

test('listTopLevelDirs excludes dot-directories like .git and .codeowl', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codeowl-git-'));
  fs.mkdirSync(path.join(tmpDir, '.git'));
  fs.mkdirSync(path.join(tmpDir, '.codeowl'));
  fs.mkdirSync(path.join(tmpDir, 'src'));

  const dirs = await listTopLevelDirs(tmpDir);
  assert.ok(!dirs.includes('.git'));
  assert.ok(!dirs.includes('.codeowl'));
  assert.ok(dirs.includes('src'));
});
