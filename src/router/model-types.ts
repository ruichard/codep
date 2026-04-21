import type { ProviderId } from "../runners/base.js";

/**
 * Normalized model spec. Source of truth is models.generated.ts, produced
 * from https://models.dev/api.json by scripts/sync-models.ts.
 */
export interface ModelSpec {
  id: string;
  displayName: string;
  provider: ProviderId;
  family: string;
  reasoning: boolean;
  toolCall: boolean;
  vision: boolean;
  contextWindow: number;
  maxOutput: number;
  /** USD per 1M input tokens. */
  costPerMInput: number;
  /** USD per 1M output tokens. */
  costPerMOutput: number;
  releaseDate?: string;
  knowledgeCutoff?: string;
}
