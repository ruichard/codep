import type { ProviderId } from "../runners/base.js";
import { PROVIDER_PROFILES, type Priority } from "./profiles.js";
import { QUALITY_MATRIX, type TaskType } from "./taxonomy.js";

export interface ScoreBreakdown {
  provider: ProviderId;
  score: number;
  quality: number;
  costPenalty: number;
}

/**
 * Weight of the cost penalty by priority. `quality` effectively ignores cost;
 * `cheap` strongly prefers cheaper providers.
 *
 *   score = 100 * quality - alpha * avgCostPerM
 *
 * (latency penalty reserved for post-P1.6 when we have real measurements.)
 */
const ALPHA_BY_PRIORITY: Record<Priority, number> = {
  quality: 0.5,
  balanced: 2.0,
  cheap: 8.0,
};

export function scoreProviders(
  candidates: readonly ProviderId[],
  taskType: TaskType,
  priority: Priority,
): ScoreBreakdown[] {
  const alpha = ALPHA_BY_PRIORITY[priority]!;
  const row = QUALITY_MATRIX[taskType]!;

  return candidates
    .map<ScoreBreakdown>((provider) => {
      const quality = row[provider];
      const cost = PROVIDER_PROFILES[provider].avgCostPerM;
      const costPenalty = alpha * cost;
      const score = 100 * quality - costPenalty;
      return { provider, score, quality, costPenalty };
    })
    .sort((a, b) => b.score - a.score);
}
