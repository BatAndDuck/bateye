const test = require('node:test');
const assert = require('node:assert/strict');

const {
  clampScore,
  normalizeReviewerScore,
  computeOverallScore,
  scoreToGrade,
  scoreToLabel,
} = require('../../dist/core/scoring/normalizer');

// clampScore
test('clampScore clamps negative values to 0', () => {
  assert.equal(clampScore(-10), 0);
});

test('clampScore clamps values above 100 to 100', () => {
  assert.equal(clampScore(150), 100);
});

test('clampScore rounds fractional values', () => {
  assert.equal(clampScore(85.6), 86);
  assert.equal(clampScore(85.4), 85);
});

test('clampScore returns exact boundary values unchanged', () => {
  assert.equal(clampScore(0), 0);
  assert.equal(clampScore(100), 100);
  assert.equal(clampScore(50), 50);
});

// normalizeReviewerScore
test('normalizeReviewerScore returns 50 for undefined', () => {
  assert.equal(normalizeReviewerScore(undefined), 50);
});

test('normalizeReviewerScore returns 50 for NaN', () => {
  assert.equal(normalizeReviewerScore(NaN), 50);
});

test('normalizeReviewerScore clamps and rounds valid scores', () => {
  assert.equal(normalizeReviewerScore(75), 75);
  assert.equal(normalizeReviewerScore(-5), 0);
  assert.equal(normalizeReviewerScore(110), 100);
  assert.equal(normalizeReviewerScore(72.7), 73);
});

// computeOverallScore
test('computeOverallScore returns 100 for empty array', () => {
  assert.equal(computeOverallScore([]), 100);
});

test('computeOverallScore averages reviewer scores', () => {
  const results = [
    { score: 80, findings: [] },
    { score: 60, findings: [] },
  ];
  assert.equal(computeOverallScore(results), 70);
});

test('computeOverallScore applies critical finding penalty (5 pts each)', () => {
  const results = [
    {
      score: 90,
      findings: [
        { priority: 'critical' },
        { priority: 'critical' },
      ],
    },
  ];
  // avg = 90, penalty = 2 * 5 = 10, result = 80
  assert.equal(computeOverallScore(results), 80);
});

test('computeOverallScore applies high finding penalty (2 pts each)', () => {
  const results = [
    {
      score: 80,
      findings: [{ priority: 'high' }, { priority: 'high' }],
    },
  ];
  // penalty = 2 * 2 = 4, result = 76
  assert.equal(computeOverallScore(results), 76);
});

test('computeOverallScore caps penalty at 20', () => {
  const findings = Array.from({ length: 10 }, () => ({ priority: 'critical' }));
  const results = [{ score: 100, findings }];
  // penalty would be 10 * 5 = 50, capped at 20, result = 80
  assert.equal(computeOverallScore(results), 80);
});

test('computeOverallScore ignores medium/low/info findings for penalty', () => {
  const results = [
    {
      score: 80,
      findings: [
        { priority: 'medium' },
        { priority: 'low' },
        { priority: 'info' },
      ],
    },
  ];
  // no penalty for medium/low/info
  assert.equal(computeOverallScore(results), 80);
});

// scoreToGrade
test('scoreToGrade returns A for 90 and above', () => {
  assert.equal(scoreToGrade(90), 'A');
  assert.equal(scoreToGrade(100), 'A');
  assert.equal(scoreToGrade(95), 'A');
});

test('scoreToGrade returns B for 80-89', () => {
  assert.equal(scoreToGrade(80), 'B');
  assert.equal(scoreToGrade(89), 'B');
});

test('scoreToGrade returns C for 70-79', () => {
  assert.equal(scoreToGrade(70), 'C');
  assert.equal(scoreToGrade(79), 'C');
});

test('scoreToGrade returns D for 60-69', () => {
  assert.equal(scoreToGrade(60), 'D');
  assert.equal(scoreToGrade(69), 'D');
});

test('scoreToGrade returns F for below 60', () => {
  assert.equal(scoreToGrade(59), 'F');
  assert.equal(scoreToGrade(0), 'F');
});

// scoreToLabel
test('scoreToLabel returns Excellent for 90 and above', () => {
  assert.equal(scoreToLabel(90), 'Excellent');
  assert.equal(scoreToLabel(100), 'Excellent');
});

test('scoreToLabel returns Good for 75-89', () => {
  assert.equal(scoreToLabel(75), 'Good');
  assert.equal(scoreToLabel(89), 'Good');
});

test('scoreToLabel returns Needs Improvement for 60-74', () => {
  assert.equal(scoreToLabel(60), 'Needs Improvement');
  assert.equal(scoreToLabel(74), 'Needs Improvement');
});

test('scoreToLabel returns Poor for 40-59', () => {
  assert.equal(scoreToLabel(40), 'Poor');
  assert.equal(scoreToLabel(59), 'Poor');
});

test('scoreToLabel returns Critical Issues for below 40', () => {
  assert.equal(scoreToLabel(39), 'Critical Issues');
  assert.equal(scoreToLabel(0), 'Critical Issues');
});
