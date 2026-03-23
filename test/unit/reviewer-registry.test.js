const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { getBuiltInReviewerDirs, loadReviewers } = require('../../dist/features/reviewers/application/reviewer-registry');

test('built-in reviewer directories resolve from feature-owned locations', () => {
  const dirs = getBuiltInReviewerDirs();
  assert.ok(dirs.length > 0);
  assert.ok(dirs.some(dir => dir.includes(path.join('features', 'audit', 'builtin-reviewers'))));
});

test('loadReviewers includes built-in reviewers without repo-local files', () => {
  const repoPath = fs.mkdtempSync(path.join(os.tmpdir(), 'bateye-reviewers-'));
  const result = loadReviewers(repoPath);

  assert.ok(result.reviewers.length >= 3);
  assert.ok(result.reviewers.some(reviewer => reviewer.id === 'code-quality'));
  assert.ok(result.reviewers.every(reviewer => reviewer.isBuiltIn));
});
