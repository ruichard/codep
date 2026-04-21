import type { Capabilities, ProviderId } from "../runners/base.js";
import { ALL_PROVIDERS } from "../runners/base.js";
import { applyHardConstraints, type HardConstraints } from "./constraints.js";
import { scoreProviders, type ScoreBreakdown } from "./scorer.js";
import type { Priority } from "./profiles.js";
import type { TaskType } from "./taxonomy.js";

export type FallbackPolicy = "auto" | "warn" | "fail";

export interface RouteInput {
  prompt: string;
  /** Explicit provider, short-circuits scoring. */
  forcedProvider?: ProviderId;
  /** Explicit task type, skips classifier. Defaults to `general_chat` in P1.3. */
  taskType?: TaskType;
  priority: Priority;
  constraints: HardConstraints;
  availability: Record<ProviderId, Capabilities>;
  fallbackPolicy: FallbackPolicy;
  /** If set, only these providers are eligible (unless --model forces). */
  allowProviders?: readonly ProviderId[];
  /** Providers excluded from routing (unless --model forces). */
  denyProviders?: readonly ProviderId[];
  /** Pinned provider for a specific task type (unless --model forces). */
  perTaskType?: Partial<Record<TaskType, ProviderId>>;
}

export type RouteOutcome =
  | {
      kind: "ok";
      provider: ProviderId;
      reason: string;
      taskType: TaskType;
      priority: Priority;
      scores: ScoreBreakdown[];
      idealProvider?: ProviderId;
      degraded: boolean;
    }
  | {
      kind: "no_providers";
      reason: string;
    }
  | {
      kind: "forced_unavailable";
      provider: ProviderId;
      reason: string;
    }
  | {
      kind: "constraints_empty";
      rejected: Array<{ provider: ProviderId; reason: string }>;
    }
  | {
      kind: "ideal_unavailable_fail";
      idealProvider: ProviderId;
      reason: string;
    };

function usable(a: Capabilities): boolean {
  return a.installed && a.authenticated;
}

/**
 * Phase-1 router pipeline.
 *  1. Resolve availability → candidates.
 *  2. Short-circuit on forced provider.
 *  3. Apply hard constraints (vision / context).
 *  4. Score & pick top; apply fallback policy if top isn't available.
 */
export function route(input: RouteInput): RouteOutcome {
  const {
    forcedProvider,
    taskType = "general_chat",
    priority,
    constraints,
    availability,
    fallbackPolicy,
    allowProviders,
    denyProviders,
    perTaskType,
  } = input;

  const allAvailable = ALL_PROVIDERS.filter((id) => usable(availability[id]));

  // Forced provider short-circuit — still honors availability, ignores allow/deny.
  if (forcedProvider) {
    if (!usable(availability[forcedProvider])) {
      const c = availability[forcedProvider];
      const why = !c.installed
        ? "not installed"
        : !c.authenticated
          ? "not authenticated"
          : "unavailable";
      return {
        kind: "forced_unavailable",
        provider: forcedProvider,
        reason: why,
      };
    }
    return {
      kind: "ok",
      provider: forcedProvider,
      reason: "forced by --model",
      taskType,
      priority,
      scores: [],
      degraded: false,
    };
  }

  // Config-pinned provider for this task type.
  const pinned = perTaskType?.[taskType];
  if (pinned) {
    if (usable(availability[pinned])) {
      return {
        kind: "ok",
        provider: pinned,
        reason: `pinned by config for ${taskType}`,
        taskType,
        priority,
        scores: [],
        degraded: false,
      };
    }
    // Fall through to normal routing if pinned provider isn't usable.
  }

  const denySet = new Set(denyProviders ?? []);
  const allowSet = allowProviders ? new Set(allowProviders) : undefined;
  const available = allAvailable.filter(
    (id) => !denySet.has(id) && (!allowSet || allowSet.has(id)),
  );

  if (available.length === 0) {
    return {
      kind: "no_providers",
      reason:
        allAvailable.length === 0
          ? "no provider CLI is installed & authenticated"
          : "all available providers are excluded by config (allow/deny)",
    };
  }

  // Constraint pruning — but score against the *full* provider set so we can
  // surface "ideal would have been X but X was pruned".
  const allScored = scoreProviders(ALL_PROVIDERS, taskType, priority);
  const idealProvider = allScored[0]!.provider;

  const { survivors, rejected } = applyHardConstraints(available, constraints);
  if (survivors.length === 0) {
    return { kind: "constraints_empty", rejected };
  }

  const scores = scoreProviders(survivors, taskType, priority);
  const winner = scores[0]!;
  const degraded =
    winner.provider !== idealProvider && !available.includes(idealProvider);

  if (degraded && fallbackPolicy === "fail") {
    return {
      kind: "ideal_unavailable_fail",
      idealProvider,
      reason: `ideal=${idealProvider} unavailable and fallback_policy=fail`,
    };
  }

  let reason: string;
  if (available.length === 1) {
    reason = "only available provider";
  } else if (degraded) {
    reason = `degraded: ideal=${idealProvider} unavailable, using ${winner.provider}`;
  } else {
    reason = `top score ${winner.score.toFixed(1)} for ${taskType} (${priority})`;
  }

  return {
    kind: "ok",
    provider: winner.provider,
    reason,
    taskType,
    priority,
    scores,
    idealProvider: degraded ? idealProvider : undefined,
    degraded,
  };
}
