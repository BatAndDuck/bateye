const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

function writeText(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, value);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env ? { ...process.env, ...options.env } : process.env,
    encoding: 'utf-8',
  });

  if (result.error) {
    throw result.error;
  }

  return result;
}

function runOk(command, args, options = {}) {
  const result = run(command, args, options);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result;
}

function initGitRepo(repoPath) {
  fs.mkdirSync(repoPath, { recursive: true });
  runOk('git', ['init'], { cwd: repoPath });
  runOk('git', ['checkout', '-b', 'main'], { cwd: repoPath });
  runOk('git', ['config', 'user.name', 'BatEye Test'], { cwd: repoPath });
  runOk('git', ['config', 'user.email', 'bateye@example.com'], { cwd: repoPath });
}

function commitAll(repoPath, message) {
  runOk('git', ['add', '.'], { cwd: repoPath });
  runOk('git', ['commit', '-m', message], { cwd: repoPath });
}

module.exports = {
  commitAll,
  initGitRepo,
  run,
  runOk,
  writeJson,
  writeText,
};
