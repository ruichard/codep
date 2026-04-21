import { MODELS } from "../config/generated/models.generated.js";
import { PROVIDER_PROFILES } from "../router/profiles.js";
import { ALL_PROVIDERS, type ProviderId } from "../runners/base.js";

export interface ModelsArgs {
  provider?: ProviderId;
  json?: boolean;
}

function fmtContext(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`;
  return String(n);
}

function fmtCost(n: number): string {
  return `$${n.toFixed(2)}`;
}

export async function modelsCommand(args: ModelsArgs): Promise<number> {
  const filtered = args.provider
    ? MODELS.filter((m) => m.provider === args.provider)
    : MODELS;

  if (args.json) {
    process.stdout.write(
      JSON.stringify(
        {
          profiles: PROVIDER_PROFILES,
          models: filtered,
        },
        null,
        2,
      ) + "\n",
    );
    return 0;
  }

  // Profiles block
  process.stdout.write("Provider profiles (from baked models.dev snapshot):\n");
  process.stdout.write(
    "  provider  flagship                           ctx     vision  avg $/M\n",
  );
  process.stdout.write(
    "  -----------------------------------------------------------------\n",
  );
  for (const id of ALL_PROVIDERS) {
    if (args.provider && id !== args.provider) continue;
    const p = PROVIDER_PROFILES[id];
    process.stdout.write(
      `  ${id.padEnd(8)}  ${p.flagship.id.padEnd(32)}   ${fmtContext(
        p.maxContextWindow,
      ).padEnd(6)}  ${p.supportsVision ? "yes" : "no ".padEnd(3)}    ${fmtCost(
        p.avgCostPerM,
      )}\n`,
    );
  }
  process.stdout.write("\n");

  // Full model list
  process.stdout.write(`Models (${filtered.length}):\n`);
  process.stdout.write(
    "  provider  id                                 family             ctx     out     $in/M  $out/M  vision\n",
  );
  process.stdout.write(
    "  ------------------------------------------------------------------------------------------------\n",
  );
  for (const m of filtered) {
    process.stdout.write(
      `  ${m.provider.padEnd(8)}  ${m.id.padEnd(34)} ${m.family.padEnd(18)} ${fmtContext(
        m.contextWindow,
      ).padEnd(6)}  ${fmtContext(m.maxOutput).padEnd(6)}  ${fmtCost(
        m.costPerMInput,
      ).padStart(6)}  ${fmtCost(m.costPerMOutput).padStart(6)}  ${m.vision ? "yes" : "no"}\n`,
    );
  }
  return 0;
}
