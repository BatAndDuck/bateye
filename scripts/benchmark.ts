#!/usr/bin/env npx ts-node
/**
 * Benchmark script for testing AI review models against a controlled PR.
 *
 * Usage:
 *   npx ts-node scripts/benchmark.ts --model openai/gpt-5.4-nano --pr https://github.com/BatAndDuck/bateye/pull/20
 *
 * Required env vars:
 *   BATEYE_LLM_MODEL_API_KEY  — API key forwarded to Vercel AI Gateway
 *   GH_BATEYE_BENCHMARK_TOKEN — GitHub token to clone the repo and read PR info
 *
 * Output:
 *   {sanitized-model}_{YYYY-MM-DD}_benchmark.md  in the current working directory
 */

import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';
import { spawnSync } from 'child_process';
import { runPRReview } from '../src/core/pr-review/runner';
import type { PRReviewResult, PRFinding } from '../src/types/index';

// ---------------------------------------------------------------------------
// Arg parsing
// ---------------------------------------------------------------------------

function getArg(flag: string): string | undefined {
  const args = process.argv.slice(2);
  const idx = args.indexOf(flag);
  return idx !== -1 ? args[idx + 1] : undefined;
}

const model = getArg('--model');
const prUrl = getArg('--pr');

if (!model || !prUrl) {
  console.error('Usage: npx ts-node scripts/benchmark.ts --model <model> --pr <pr-url>');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Env validation
// ---------------------------------------------------------------------------

const ghToken = process.env.GH_BATEYE_BENCHMARK_TOKEN;
const llmApiKey = process.env.BATEYE_LLM_MODEL_API_KEY;

if (!ghToken) {
  console.error('Error: GH_BATEYE_BENCHMARK_TOKEN environment variable is required.');
  process.exit(1);
}
if (!llmApiKey) {
  console.error('Error: BATEYE_LLM_MODEL_API_KEY environment variable is required.');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Only allow safe GitHub owner/repo characters to prevent shell injection
const GITHUB_SLUG_RE = /^[a-zA-Z0-9_.-]+$/;

function parsePrUrl(url: string): { owner: string; repo: string; prNumber: number } {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    console.error(`Error: Cannot parse URL: ${url}`);
    console.error('Expected format: https://github.com/{owner}/{repo}/pull/{number}');
    process.exit(1);
  }
  if (parsed.protocol !== 'https:' || parsed.hostname !== 'github.com') {
    console.error(`Error: URL must be https://github.com/... — got: ${url}`);
    process.exit(1);
  }
  const match = parsed.pathname.match(/^\/([^/]+)\/([^/]+)\/pull\/(\d+)$/);
  if (!match) {
    console.error(`Error: URL path does not match /owner/repo/pull/number — got: ${parsed.pathname}`);
    process.exit(1);
  }
  const [, owner, repo, prStr] = match;
  if (!GITHUB_SLUG_RE.test(owner)) {
    console.error(`Error: Invalid GitHub owner name: ${owner}`);
    process.exit(1);
  }
  if (!GITHUB_SLUG_RE.test(repo)) {
    console.error(`Error: Invalid GitHub repo name: ${repo}`);
    process.exit(1);
  }
  return { owner, repo, prNumber: parseInt(prStr, 10) };
}

async function fetchPrInfo(
  owner: string,
  repo: string,
  prNumber: number,
  token: string,
): Promise<{ baseRef: string; headSha: string }> {
  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}`, {
    headers: {
      Authorization: `token ${token}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'codeowl-benchmark/1.0',
    },
  });
  if (!res.ok) {
    const body = await res.text();
    console.error(`Error: GitHub API returned ${res.status} for PR ${prNumber}: ${body}`);
    process.exit(1);
  }
  const data = await res.json() as unknown;
  const d = data as Record<string, unknown>;
  if (typeof (d?.['base'] as Record<string, unknown>)?.['ref'] !== 'string' ||
      typeof (d?.['head'] as Record<string, unknown>)?.['sha'] !== 'string') {
    console.error(`Error: Unexpected GitHub API response shape for PR ${prNumber}`);
    process.exit(1);
  }
  return {
    baseRef: ((d['base'] as Record<string, unknown>)['ref']) as string,
    headSha: ((d['head'] as Record<string, unknown>)['sha']) as string,
  };
}

function gitExec(args: string[], opts?: { cwd?: string; token?: string }): void {
  // Use spawnSync so args are passed directly to git — no shell interpolation.
  // When a token is provided, inject it via GIT_CONFIG_* env vars so it never
  // appears in the command args or gets written into .git/config.
  const env: NodeJS.ProcessEnv = { ...process.env };
  if (opts?.token) {
    const encoded = Buffer.from(`x-access-token:${opts.token}`).toString('base64');
    env['GIT_CONFIG_COUNT'] = '1';
    env['GIT_CONFIG_KEY_0'] = 'http.https://github.com/.extraheader';
    env['GIT_CONFIG_VALUE_0'] = `Authorization: Basic ${encoded}`;
  }
  const { cwd } = opts ?? {};
  const result = spawnSync('git', args, { stdio: 'inherit', env, ...(cwd ? { cwd } : {}) });
  if (result.status !== 0) {
    throw new Error(`git ${args[0]} failed with exit code ${result.status}`);
  }
}

function sanitizeModel(m: string): string {
  return m.replace(/[/\\:*?"<>|]/g, '_');
}

// ---------------------------------------------------------------------------
// Markdown formatter
// ---------------------------------------------------------------------------

function formatMarkdown(result: PRReviewResult, mdModel: string, mdPrUrl: string): string {
  const date = new Date().toISOString().split('T')[0];
  const lines: string[] = [];

  lines.push('# Benchmark Report');
  lines.push('');
  lines.push(`**Model**: ${mdModel}`);
  lines.push(`**Date**: ${date}`);
  lines.push(`**PR**: ${mdPrUrl}`);
  lines.push(`**Status**: ${result.status}`);
  lines.push('');

  // Summary
  lines.push('## Summary');
  lines.push('');
  lines.push(result.summary || '_No summary provided._');
  lines.push('');

  // Findings
  const findings: PRFinding[] = result.findings ?? [];
  lines.push(`## Findings (${findings.length} total)`);
  lines.push('');

  if (findings.length === 0) {
    lines.push('_No findings reported._');
    lines.push('');
  } else {
    findings.forEach((f, i) => {
      const loc = `${f.filePath}:${f.startLine}${f.endLine && f.endLine !== f.startLine ? `–${f.endLine}` : ''}`;
      lines.push(`### ${i + 1}. [${f.priority.toUpperCase()}] ${f.title}`);
      lines.push('');
      lines.push(`- **File**: \`${loc}\``);
      lines.push(`- **Reviewer**: ${f.reviewerId}`);
      lines.push(`- **Confidence**: ${(f.confidence * 100).toFixed(0)}%`);
      lines.push(`- **Description**: ${f.description}`);
      if (f.codeQuote) {
        const quote = f.codeQuote.length > 200 ? f.codeQuote.slice(0, 200) + '…' : f.codeQuote;
        lines.push(`- **Code**: \`${quote.replace(/`/g, "'")}\``);
      }
      lines.push(`- **Recommendation**: ${f.recommendation}`);
      if (f.tags && f.tags.length > 0) {
        lines.push(`- **Tags**: ${f.tags.join(', ')}`);
      }
      lines.push('');
    });
  }

  // Selected reviewers
  if (result.selectedReviewers && result.selectedReviewers.length > 0) {
    lines.push('## Selected Reviewers');
    lines.push('');
    lines.push('| Reviewer | Confidence | Reason |');
    lines.push('|----------|------------|--------|');
    for (const r of result.selectedReviewers) {
      const reason = (r.reason ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
      lines.push(`| ${r.reviewerId} | ${(r.confidence * 100).toFixed(0)}% | ${reason} |`);
    }
    lines.push('');
  }

  // Verification stats
  if (result.verificationStats) {
    const s = result.verificationStats;
    lines.push('## Verification Stats');
    lines.push('');
    lines.push('| Metric | Count |');
    lines.push('|--------|-------|');
    lines.push(`| Raw findings | ${s.rawFindings} |`);
    lines.push(`| Confidence rejected | ${s.confidenceRejected} |`);
    lines.push(`| Deterministic rejected | ${s.deterministicRejected} |`);
    lines.push(`| Diff-gate rejected | ${s.diffGateRejected} |`);
    lines.push(`| Semantic rejected | ${s.semanticRejected} |`);
    lines.push(`| **Final findings** | **${s.finalFindings}** |`);
    lines.push('');
  }

  // Token usage
  if (result.tokenUsage) {
    lines.push('## Token Usage');
    lines.push('');
    lines.push(`- Input tokens: ${result.tokenUsage.inputTokens.toLocaleString()}`);
    lines.push(`- Output tokens: ${result.tokenUsage.outputTokens.toLocaleString()}`);
    if (result.tokenUsage.estimated) {
      lines.push('- _(estimated)_');
    }
    lines.push('');
  }

  // Issues/warnings
  if (result.issues && result.issues.length > 0) {
    lines.push('## Run Issues');
    lines.push('');
    for (const issue of result.issues) {
      lines.push(`- **[${issue.severity.toUpperCase()}]** \`${issue.code}\`: ${issue.message}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const { owner, repo, prNumber } = parsePrUrl(prUrl!);

  console.log(`\nBenchmark: ${model}`);
  console.log(`PR: ${prUrl}\n`);

  console.log('Fetching PR info from GitHub…');
  const { baseRef } = await fetchPrInfo(owner, repo, prNumber, ghToken!);
  console.log(`  Base branch: ${baseRef}`);

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codeowl-benchmark-'));
  console.log(`  Temp dir: ${tmpDir}`);

  try {
    // Clone and checkout PR branch — token passed via GIT_CONFIG env vars, never in the URL or args
    console.log('\nCloning repository…');
    gitExec(['clone', '--depth', '50', `https://github.com/${owner}/${repo}`, tmpDir], { token: ghToken! });

    console.log(`Fetching PR #${prNumber}…`);
    gitExec(['fetch', 'origin', `pull/${prNumber}/head:pr-${prNumber}`], { cwd: tmpDir });
    gitExec(['checkout', `pr-${prNumber}`], { cwd: tmpDir });

    // Write config pointing to the specified model via Vercel AI Gateway
    await fs.mkdir(path.join(tmpDir, '.bateye'), { recursive: true });
    await fs.writeFile(
      path.join(tmpDir, '.bateye', 'config.json'),
      JSON.stringify({ model, transport: 'vercel' }, null, 2),
    );

    // Ensure API key is set in the process environment
    process.env.BATEYE_LLM_MODEL_API_KEY = llmApiKey!;

    // Run PR review
    console.log('\nRunning PR review…');
    const result = await runPRReview({
      repoPath: tmpDir,
      baseRef: `origin/${baseRef}`,
      headRef: 'HEAD',
      github: false,
      onProgress: (msg) => process.stdout.write(`  ${msg}\n`),
    });

    // Format and save output
    const sanitized = sanitizeModel(model!);
    const date = new Date().toISOString().split('T')[0];
    const benchmarkDir = path.join(process.cwd(), '.bateye', 'benchmark');
    await fs.mkdir(benchmarkDir, { recursive: true });
    const outputFile = path.join(benchmarkDir, `${sanitized}_${date}_benchmark.md`);

    const markdown = formatMarkdown(result, model!, prUrl!);
    await fs.writeFile(outputFile, markdown, 'utf8');

    console.log(`\n✓ Benchmark complete.`);
    console.log(`  Findings: ${result.findings?.length ?? 0}`);
    console.log(`  Status: ${result.status}`);
    console.log(`  Output: ${outputFile}\n`);
  } finally {
    // Swallow cleanup errors — Windows may hold file locks briefly after git operations
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {
      console.warn(`  Warning: could not fully clean up temp dir: ${tmpDir}`);
    });
  }
}

main().catch((err) => {
  console.error('\nBenchmark failed:', err);
  process.exit(1);
});
