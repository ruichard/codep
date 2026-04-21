import type { ProviderId } from "../runners/base.js";
import { PROVIDER_PROFILES } from "./profiles.js";

export interface HardConstraints {
  /** Estimated total input tokens. If set, providers below this window are pruned. */
  contextTokens?: number;
  /** Task carries image/PDF input. Prunes providers without vision models. */
  needsVision?: boolean;
}

export interface ConstraintResult {
  survivors: ProviderId[];
  rejected: Array<{ provider: ProviderId; reason: string }>;
}

export function applyHardConstraints(
  candidates: readonly ProviderId[],
  c: HardConstraints,
): ConstraintResult {
  const survivors: ProviderId[] = [];
  const rejected: ConstraintResult["rejected"] = [];

  for (const id of candidates) {
    const prof = PROVIDER_PROFILES[id];

    if (
      c.contextTokens !== undefined &&
      c.contextTokens > prof.maxContextWindow
    ) {
      rejected.push({
        provider: id,
        reason: `context ${c.contextTokens} > max window ${prof.maxContextWindow}`,
      });
      continue;
    }

    if (c.needsVision && !prof.supportsVision) {
      rejected.push({ provider: id, reason: "no vision-capable model" });
      continue;
    }

    survivors.push(id);
  }

  return { survivors, rejected };
}
