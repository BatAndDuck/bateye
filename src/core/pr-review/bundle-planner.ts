import { ExecutionPlanGroup, Reviewer } from '../../types/index';

/**
 * A validated execution group ready for the pipeline to consume. Unlike the raw
 * `ExecutionPlanGroup` that the orchestrator emits, an `ExecutionGroup` carries the
 * resolved `Reviewer` objects and is guaranteed to satisfy BatEye's safety rules:
 *
 *   - every reviewer in the group shares the same effective model (or has none)
 *   - no reviewer in the group has a `tool` (tool output is injected per reviewer)
 *   - every reviewer in the group shares the same category, or the group is a
 *     single-reviewer isolation group
 *
 * Groups with length > 1 are executed as a single OpenCode session with a
 * bundle prompt; length === 1 groups fall through to the per-reviewer path.
 */
export interface ExecutionGroup {
  groupId: string;
  mode: 'standard' | 'deep';
  reason: string;
  reviewers: Reviewer[];
}

/**
 * Semantic category → bundle slot mapping. Only used for the deterministic fallback
 * when the orchestrator does not propose a plan. Built-in reviewers whose `category`
 * falls into one of these four slots are merged into the slot's bundle; everything
 * else is isolated.
 */
const CATEGORY_BUNDLE: Record<string, string> = {
  security: 'security',
  compliance: 'security',
  dependency: 'security',
  'code-quality': 'correctness',
  qa: 'correctness',
  architecture: 'contract-qa',
  documentation: 'contract-qa',
  ai: 'contract-qa',
  database: 'contract-qa',
  performance: 'ops',
  infrastructure: 'ops',
  sre: 'ops',
  devex: 'ops',
  ux: 'ops',
};

const BUNDLE_REASONS: Record<string, string> = {
  security: 'Reviewers share security/compliance evidence and inspect the same sensitive paths.',
  correctness: 'Reviewers overlap on runtime correctness and exercise the same code paths.',
  'contract-qa': 'Reviewers inspect the same public contracts, schemas, and docs.',
  ops: 'Reviewers read the same operational/deployment surfaces.',
};

/**
 * Return true when two reviewers can safely share a single agentic session.
 *
 * Merging is UNSAFE when:
 *   - either has a `tool` (tool output is user-message-scoped to one reviewer)
 *   - their effective models differ in any way. Note that an undefined model
 *     (use the pipeline default) is treated as distinct from any explicit
 *     override, because merging them would silently pull the default-model
 *     reviewer onto the overridden model.
 */
function areMergeable(a: Reviewer, b: Reviewer): boolean {
  if (a.tool || b.tool) return false;
  if ((a.model ?? null) !== (b.model ?? null)) return false;
  return true;
}

/**
 * Deterministically split a candidate group into subgroups that all satisfy the
 * pairwise merge rules. The first reviewer seeds the "kept" group; anything that
 * can't merge with it is recursively pushed into its own subgroup.
 */
function enforceSafetySplits(
  groupId: string,
  mode: 'standard' | 'deep',
  reason: string,
  reviewers: Reviewer[],
): ExecutionGroup[] {
  if (reviewers.length === 0) return [];
  if (reviewers.length === 1) {
    return [{ groupId, mode, reason, reviewers }];
  }

  const head = reviewers[0];
  if (head.tool) {
    // Tool reviewers are always isolated.
    return [
      { groupId: `${head.id}`, mode, reason: `Isolated: ${head.name} requires a dedicated tool invocation.`, reviewers: [head] },
      ...enforceSafetySplits(groupId, mode, reason, reviewers.slice(1)),
    ];
  }

  const kept: Reviewer[] = [head];
  const split: Reviewer[] = [];
  for (const candidate of reviewers.slice(1)) {
    if (areMergeable(head, candidate) && kept.every(r => areMergeable(r, candidate))) {
      kept.push(candidate);
    } else {
      split.push(candidate);
    }
  }

  const result: ExecutionGroup[] = [{ groupId, mode, reason, reviewers: kept }];
  if (split.length > 0) {
    result.push(...enforceSafetySplits(`${groupId}-split`, mode, reason, split));
  }
  return result;
}

/**
 * Build a fallback plan when the orchestrator did not propose one. Groups built-in
 * reviewers by the `CATEGORY_BUNDLE` mapping; custom reviewers (isBuiltIn === false)
 * are merged into the same bundle only when their category maps cleanly and they have
 * no tool/model override. Anything else lands in its own isolated group.
 */
function buildFallbackPlan(selected: Reviewer[]): ExecutionGroup[] {
  const bundleMap = new Map<string, Reviewer[]>();
  const isolated: Reviewer[] = [];

  for (const reviewer of selected) {
    const category = reviewer.category;
    const bundleId = category ? CATEGORY_BUNDLE[category] : undefined;

    const canMerge = bundleId !== undefined && !reviewer.tool;
    // Extra caution for custom reviewers: only merge if they also lack a model override,
    // which could otherwise force the whole bundle onto the wrong model.
    const canMergeCustom = canMerge && (reviewer.isBuiltIn || !reviewer.model);

    if (bundleId && canMergeCustom) {
      const existing = bundleMap.get(bundleId);
      if (existing) {
        existing.push(reviewer);
      } else {
        bundleMap.set(bundleId, [reviewer]);
      }
    } else {
      isolated.push(reviewer);
    }
  }

  const groups: ExecutionGroup[] = [];
  for (const [bundleId, reviewers] of bundleMap.entries()) {
    const reason = BUNDLE_REASONS[bundleId] ?? 'Reviewers share investigation scope.';
    groups.push(...enforceSafetySplits(bundleId, 'standard', reason, reviewers));
  }
  for (const reviewer of isolated) {
    groups.push({
      groupId: reviewer.id,
      mode: 'standard',
      reason: `Isolated: ${reviewer.name} cannot be safely merged into a shared bundle.`,
      reviewers: [reviewer],
    });
  }
  return groups;
}

/**
 * Build the execution plan the pipeline will actually run.
 *
 * If the orchestrator supplied a plan, use it as the starting point but enforce
 * deterministic safety splits on every group (model overrides, tool reviewers,
 * unknown reviewer IDs). Any reviewer that appears in `selected` but is missing
 * from the orchestrator's plan is placed in its own isolated group so coverage
 * is never silently dropped.
 *
 * If the orchestrator did not supply a plan (or it became empty after filtering),
 * fall back to a category-keyed grouping of the selected reviewers.
 */
export function buildExecutionPlan(
  selected: Reviewer[],
  orchestratorPlan: ExecutionPlanGroup[] | undefined,
): ExecutionGroup[] {
  if (selected.length === 0) return [];

  const byId = new Map(selected.map(r => [r.id, r]));

  if (!orchestratorPlan || orchestratorPlan.length === 0) {
    return buildFallbackPlan(selected);
  }

  const assigned = new Set<string>();
  const groups: ExecutionGroup[] = [];

  for (const proposed of orchestratorPlan) {
    const reviewers: Reviewer[] = [];
    for (const id of proposed.reviewerIds) {
      const reviewer = byId.get(id);
      if (!reviewer) continue; // Unknown ID: silently drop.
      if (assigned.has(id)) continue; // Already assigned to an earlier group; prevent double-run.
      reviewers.push(reviewer);
      assigned.add(id);
    }
    if (reviewers.length === 0) continue;
    groups.push(
      ...enforceSafetySplits(proposed.groupId, proposed.mode, proposed.reason, reviewers),
    );
  }

  // Any selected reviewer the orchestrator omitted runs on its own. Never silently drop.
  const omitted = selected.filter(r => !assigned.has(r.id));
  for (const reviewer of omitted) {
    groups.push({
      groupId: reviewer.id,
      mode: 'standard',
      reason: `Isolated: ${reviewer.name} was selected but not placed in any orchestrator group.`,
      reviewers: [reviewer],
    });
  }

  return groups;
}
