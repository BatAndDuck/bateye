const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

test('init creates config.json and gitignores config.local.json', () => {
  const repoPath = fs.mkdtempSync(path.join(os.tmpdir(), 'bateye-init-int-'));

  const result = spawnSync(
    'node',
    ['dist/index.js', 'init', '--cwd', repoPath],
    {
      cwd: process.cwd(),
      encoding: 'utf-8',
    },
  );

  assert.equal(result.status, 0, result.stderr || result.stdout);

  const configPath = path.join(repoPath, '.bateye', 'config.json');
  const gitignorePath = path.join(repoPath, '.gitignore');
  assert.equal(fs.existsSync(configPath), true);
  assert.equal(fs.existsSync(gitignorePath), true);

  const gitignore = fs.readFileSync(gitignorePath, 'utf-8');
  assert.match(gitignore, /^# BatEye$/m);
  assert.match(gitignore, /^\.bateye\/out\/$/m);
  assert.match(gitignore, /^\.bateye\/config\.local\.json$/m);
});
