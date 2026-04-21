import type { ProviderId } from "../runners/base.js";
import { ALL_PROVIDERS } from "../runners/base.js";
import type { ModelSpec } from "./model-types.js";
import { MODELS } from "../config/generated/models.generated.js";

export type Priority = "quality" | "balanced" | "cheap";

/** Per-provider summary derived from the models.dev snapshot. */
export interface ProviderProfile {
  provider: ProviderId;
  /** Flagship model used to represent cost / context for this provider. */
  flagship: ModelSpec;
  maxContextWindow: number;
  supportsVision: boolean;
  /** Average $/1M tokens (input+output averaged) across non-nano flagships. */
  avgCostPerM: number;
}

function pickFlagship(provider: ProviderId): ModelSpec {
  // "Flagship" = priciest output-tier model for the provider. This proxies
  // capability class (opus > sonnet > haiku; pro > mini > nano).
  const list = MODELS.filter((m) => m.provider === provider);
  if (list.length === 0) {
    throw new Error(
      `No models found for provider ${provider} in generated snapshot. ` +
        "Run `pnpm run sync-models`.",
    );
  }
  return [...list].sort(
    (a, b) => b.costPerMOutput - a.costPerMOutput,
  )[0]!;
}

export const PROVIDER_PROFILES: Record<ProviderId, ProviderProfile> =
  (function build() {
    const out = {} as Record<ProviderId, ProviderProfile>;
    for (const id of ALL_PROVIDERS) {
      const list = MODELS.filter((m) => m.provider === id);
      const flagship = pickFlagship(id);
      out[id] = {
        provider: id,
        flagship,
        maxContextWindow: Math.max(...list.map((m) => m.contextWindow)),
        supportsVision: list.some((m) => m.vision),
        avgCostPerM:
          list.reduce(
            (s, m) => s + (m.costPerMInput + m.costPerMOutput) / 2,
            0,
          ) / list.length,
      };
    }
    return out;
  })();
