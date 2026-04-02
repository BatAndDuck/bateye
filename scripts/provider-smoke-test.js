#!/usr/bin/env node

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const WORKSPACE_ROOT = path.resolve(__dirname, '..');
const DIST_CLI_PATH = path.join(WORKSPACE_ROOT, 'dist', 'index.js');
const DIST_REVIEWER_REGISTRY_PATH = path.join(
  WORKSPACE_ROOT,
  'dist',
  'features',
  'reviewers',
  'application',
  'reviewer-registry.js',
);

const REVIEWER_ID = 'integration-smoke';
const REVIEWER_NAME = 'Integration Smoke';

function parseArgs(argv) {
  const options = {
    provider: '',
    model: '',
    transport: '',
    artifactsDir: '',
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];

    switch (arg) {
      case '--provider':
        options.provider = next || '';
        i++;
        break;
      case '--model':
        options.model = next || '';
        i++;
        break;
      case '--transport':
        options.transport = next || '';
        i++;
        break;
      case '--artifacts-dir':
        options.artifactsDir = next || '';
        i++;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!options.provider) {
    throw new Error('Missing required argument: --provider');
  }
  if (!options.model) {
    throw new Error('Missing required argument: --model');
  }

  return options;
}

function ensureBuiltArtifacts() {
  if (!fs.existsSync(DIST_CLI_PATH) || !fs.existsSync(DIST_REVIEWER_REGISTRY_PATH)) {
    throw new Error('Built artifacts are missing. Run `npm run build` before the provider smoke test.');
  }
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function writeText(filePath, content) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, content, 'utf8');
}

function writeJson(filePath, value) {
  writeText(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function runCommand(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || WORKSPACE_ROOT,
    env: options.env || process.env,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    windowsHide: true,
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    const error = new Error(
      [
        `Command failed (${result.status}): ${command} ${args.join(' ')}`.trim(),
        result.stdout?.trim() ? `stdout:\n${result.stdout.trim()}` : '',
        result.stderr?.trim() ? `stderr:\n${result.stderr.trim()}` : '',
      ].filter(Boolean).join('\n\n'),
    );
    error.stdout = result.stdout || '';
    error.stderr = result.stderr || '';
    error.status = result.status;
    throw error;
  }

  return {
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    status: result.status,
  };
}

function getReviewerRegistry() {
  ensureBuiltArtifacts();
  return require(DIST_REVIEWER_REGISTRY_PATH);
}

function buildCustomReviewer() {
  return `---
id: ${REVIEWER_ID}
name: ${REVIEWER_NAME}
description: Minimal reviewer used to validate provider integrations in CI.
enabled: true
mode: pr-review
selectWhen: "always select for any real source-code change"
---

You are the BatEye provider integration smoke-test reviewer.

Your job is to verify that the PR review pipeline can inspect the repository and return valid structured JSON.

Rules:
- Prefer zero findings.
- Only report a finding when the changed lines contain an obvious syntax error or a guaranteed runtime failure.
- If the change looks reasonable, return \`findings: []\`, \`score: 100\`, and a short summary.
- Do not invent issues.
`;
}

function createSmokeRepository(options) {
  const repoPath = fs.mkdtempSync(path.join(os.tmpdir(), `bateye-provider-smoke-${options.provider}-`));
  const customReviewerPath = path.join(repoPath, '.bateye', 'reviewers', `${REVIEWER_ID}.md`);
  writeText(customReviewerPath, buildCustomReviewer());

  const { loadReviewers } = getReviewerRegistry();
  const builtInReviewerIds = loadReviewers(repoPath).reviewers
    .filter(reviewer => reviewer.isBuiltIn)
    .map(reviewer => reviewer.id)
    .sort();

  const config = {
    model: options.model,
    ...(options.transport ? { transport: options.transport } : {}),
    prReview: {
      maxReviewers: 1,
    },
    disabledReviewers: {
      prReview: builtInReviewerIds,
    },
  };

  writeJson(path.join(repoPath, '.bateye', 'config.json'), config);
  writeJson(path.join(repoPath, 'package.json'), {
    name: `bateye-provider-smoke-${options.provider}`,
    version: '1.0.0',
    private: true,
  });
  writeText(
    path.join(repoPath, 'src', 'math.js'),
    [
      'function add(a, b) {',
      '  return a + b;',
      '}',
      '',
      'module.exports = {',
      '  add,',
      '};',
      '',
    ].join('\n'),
  );

  runCommand('git', ['init', '-b', 'main'], { cwd: repoPath });
  runCommand('git', ['config', 'user.name', 'BatEye Smoke Test'], { cwd: repoPath });
  runCommand('git', ['config', 'user.email', 'bateye-smoke@example.com'], { cwd: repoPath });
  runCommand('git', ['add', '.'], { cwd: repoPath });
  runCommand('git', ['commit', '-m', 'chore: seed smoke repo'], { cwd: repoPath });

  writeText(
    path.join(repoPath, 'src', 'math.js'),
    [
      'function add(a, b) {',
      '  return a + b;',
      '}',
      '',
      'function multiply(a, b) {',
      '  return a * b;',
      '}',
      '',
      'module.exports = {',
      '  add,',
      '  multiply,',
      '};',
      '',
    ].join('\n'),
  );
  runCommand('git', ['add', 'src/math.js'], { cwd: repoPath });
  runCommand('git', ['commit', '-m', 'feat: add multiply helper'], { cwd: repoPath });

  return {
    repoPath,
    config,
    builtInReviewerIds,
  };
}

function resolveBateyeInvocation() {
  const probe = spawnSync('bateye', ['--version'], {
    cwd: WORKSPACE_ROOT,
    encoding: 'utf8',
    windowsHide: true,
  });

  if (!probe.error && probe.status === 0) {
    return {
      command: 'bateye',
      args: [],
      source: 'linked-cli',
    };
  }

  return {
    command: process.execPath,
    args: [DIST_CLI_PATH],
    source: 'dist-cli',
  };
}

function copyPathIfPresent(sourcePath, targetPath) {
  if (!fs.existsSync(sourcePath)) {
    return;
  }
  fs.cpSync(sourcePath, targetPath, { recursive: true });
}

function saveArtifacts(repoPath, artifactsDir, metadata, cliOutput) {
  if (!artifactsDir) {
    return;
  }

  const absoluteArtifactsDir = path.resolve(WORKSPACE_ROOT, artifactsDir);
  fs.rmSync(absoluteArtifactsDir, { recursive: true, force: true });
  ensureDir(absoluteArtifactsDir);

  copyPathIfPresent(path.join(repoPath, '.bateye'), path.join(absoluteArtifactsDir, '.bateye'));
  copyPathIfPresent(path.join(repoPath, 'src'), path.join(absoluteArtifactsDir, 'src'));
  copyPathIfPresent(path.join(repoPath, 'package.json'), path.join(absoluteArtifactsDir, 'package.json'));

  writeJson(path.join(absoluteArtifactsDir, 'metadata.json'), metadata);
  writeText(path.join(absoluteArtifactsDir, 'stdout.log'), cliOutput.stdout || '');
  writeText(path.join(absoluteArtifactsDir, 'stderr.log'), cliOutput.stderr || '');

  try {
    const diff = runCommand('git', ['diff', 'HEAD~1', 'HEAD'], { cwd: repoPath });
    writeText(path.join(absoluteArtifactsDir, 'git-diff.patch'), diff.stdout);
  } catch {
    writeText(path.join(absoluteArtifactsDir, 'git-diff.patch'), '');
  }
}

function parseResult(resultPath) {
  if (!fs.existsSync(resultPath)) {
    throw new Error(`BatEye did not write the expected output file: ${resultPath}`);
  }

  try {
    return JSON.parse(fs.readFileSync(resultPath, 'utf8'));
  } catch (error) {
    throw new Error(`Failed to parse ${resultPath}: ${error.message}`);
  }
}

function validateResult(result) {
  const problems = [];

  if (!result || typeof result !== 'object') {
    problems.push('PR review output is not a JSON object.');
  }
  if (result.command !== 'pr-review') {
    problems.push(`Expected command=pr-review, got ${JSON.stringify(result.command)}.`);
  }
  if (result.status !== 'complete') {
    problems.push(`Expected status=complete, got ${JSON.stringify(result.status)}.`);
  }
  if (!Array.isArray(result.issues)) {
    problems.push('Expected issues to be an array.');
  } else if (result.issues.length > 0) {
    problems.push(`Expected no issues, got ${result.issues.length}.`);
  }
  if (!Array.isArray(result.selectedReviewers)) {
    problems.push('Expected selectedReviewers to be an array.');
  } else if (result.selectedReviewers.length !== 1) {
    problems.push(`Expected exactly 1 reviewer, got ${result.selectedReviewers.length}.`);
  } else if (result.selectedReviewers[0].reviewerId !== REVIEWER_ID) {
    problems.push(`Expected reviewer ${REVIEWER_ID}, got ${JSON.stringify(result.selectedReviewers[0].reviewerId)}.`);
  }
  if (typeof result.summary !== 'string' || result.summary.trim().length === 0) {
    problems.push('Expected a non-empty summary.');
  }
  if (!Array.isArray(result.findings)) {
    problems.push('Expected findings to be an array.');
  }
  if (!result.verificationStats || typeof result.verificationStats.finalFindings !== 'number') {
    problems.push('Expected verificationStats.finalFindings to be present.');
  }
  if (typeof result.generatedAt !== 'string' || Number.isNaN(Date.parse(result.generatedAt))) {
    problems.push('Expected generatedAt to be a valid ISO timestamp.');
  }

  if (problems.length > 0) {
    throw new Error(problems.join('\n'));
  }
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const smoke = createSmokeRepository(options);
  const invocation = resolveBateyeInvocation();
  const cliOutput = {
    stdout: '',
    stderr: '',
  };
  const resultPath = path.join(smoke.repoPath, '.bateye', 'out', 'pr-review.json');

  try {
    const commandResult = runCommand(
      invocation.command,
      [
        ...invocation.args,
        '--cwd',
        smoke.repoPath,
        '--diagnostic',
        '.bateye/out/diagnostics',
        'pr-review',
        '--base',
        'HEAD~1',
        '--head',
        'HEAD',
      ],
      {
        cwd: WORKSPACE_ROOT,
        env: process.env,
      },
    );

    cliOutput.stdout = commandResult.stdout;
    cliOutput.stderr = commandResult.stderr;

    const result = parseResult(resultPath);
    validateResult(result);

    saveArtifacts(
      smoke.repoPath,
      options.artifactsDir,
      {
        provider: options.provider,
        model: options.model,
        transport: options.transport || 'auto',
        bateyeInvocation: invocation.source,
        expectedReviewerId: REVIEWER_ID,
        disabledBuiltInReviewers: smoke.builtInReviewerIds,
        status: 'passed',
      },
      cliOutput,
    );

    console.log(`Provider smoke test passed for ${options.provider} (${options.model}).`);
  } catch (error) {
    saveArtifacts(
      smoke.repoPath,
      options.artifactsDir,
      {
        provider: options.provider,
        model: options.model,
        transport: options.transport || 'auto',
        bateyeInvocation: invocation.source,
        expectedReviewerId: REVIEWER_ID,
        disabledBuiltInReviewers: smoke.builtInReviewerIds,
        status: 'failed',
        error: error.message,
      },
      cliOutput,
    );

    throw error;
  } finally {
    if (process.env.BATEYE_KEEP_SMOKE_REPO !== '1') {
      fs.rmSync(smoke.repoPath, { recursive: true, force: true });
    } else {
      console.error(`BATEYE_KEEP_SMOKE_REPO=1, preserved temp repo at ${smoke.repoPath}`);
    }
  }
}

try {
  ensureBuiltArtifacts();
  main();
} catch (error) {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
}
