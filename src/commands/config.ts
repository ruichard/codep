import { getGlobalConfigPath, loadConfig } from "../config/load.js";

export interface ConfigShowArgs {
  json?: boolean;
}

export async function configShowCommand(
  args: ConfigShowArgs,
): Promise<number> {
  let loaded;
  try {
    loaded = await loadConfig();
  } catch (err) {
    process.stderr.write(
      `codep: config error: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    return 2;
  }

  if (args.json) {
    process.stdout.write(
      JSON.stringify(
        { config: loaded.config, sources: loaded.sources },
        null,
        2,
      ) + "\n",
    );
    return 0;
  }

  process.stdout.write(`Global config path: ${getGlobalConfigPath()}\n`);
  if (loaded.sources.length === 0) {
    process.stdout.write("Loaded from:        (no config files found)\n");
  } else {
    process.stdout.write(
      `Loaded from:        ${loaded.sources.join(" + ")}\n`,
    );
  }
  process.stdout.write("\nMerged config:\n");
  const c = loaded.config;
  const pairs: Array<[string, unknown]> = [
    ["priority", c.priority],
    ["fallbackPolicy", c.fallbackPolicy],
    ["allowProviders", c.allowProviders],
    ["denyProviders", c.denyProviders],
    ["perTaskType", c.perTaskType],
    ["timeoutSec", c.timeoutSec],
    ["providers", c.providers ? Object.keys(c.providers) : undefined],
    ["classifier", c.classifier],
    ["classifierProvider", c.classifierProvider],
    ["classifierConfidenceThreshold", c.classifierConfidenceThreshold],
    ["classifierTimeoutMs", c.classifierTimeoutMs],
  ];
  let any = false;
  for (const [k, v] of pairs) {
    if (v === undefined) continue;
    // Skip empty objects/arrays from merge() defaults so output stays clean.
    if (Array.isArray(v) && v.length === 0) continue;
    if (
      typeof v === "object" &&
      v !== null &&
      !Array.isArray(v) &&
      Object.keys(v as object).length === 0
    )
      continue;
    any = true;
    process.stdout.write(`  ${k}: ${JSON.stringify(v)}\n`);
  }
  if (!any) process.stdout.write("  (empty — using built-in defaults)\n");
  return 0;
}
