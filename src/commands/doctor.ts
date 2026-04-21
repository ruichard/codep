import { detectAll } from "../router/availability.js";
import type { Capabilities } from "../runners/base.js";
import { ALL_PROVIDERS } from "../runners/base.js";
import { RUNNER_REGISTRY } from "../runners/registry.js";
import { INSTALL_GUIDES } from "../runners/install-guides.js";
import { loadConfig } from "../config/load.js";
import { getLogPath } from "../log/run-log.js";
import { getSessionsDir } from "../session/store.js";
import { buildCustomRunners } from "../runners/custom.js";

export interface DoctorArgs {
  json?: boolean;
}

function icon(b: boolean | undefined): string {
  if (b === true) return "✓";
  if (b === false) return "✗";
  return "·";
}

export async function doctorCommand(args: DoctorArgs = {}): Promise<number> {
  const caps = await detectAll({ probe: true, force: true });

  let configSources: string[] = [];
  let configError: string | undefined;
  let customProviders: Record<string, unknown> = {};
  try {
    const loaded = await loadConfig();
    configSources = loaded.sources;
    customProviders = loaded.config.providers ?? {};
  } catch (err) {
    configError = err instanceof Error ? err.message : String(err);
  }

  const customRunners = Object.keys(customProviders).length
    ? buildCustomRunners(customProviders as never)
    : {};
  const customCaps: Record<string, Capabilities> = {};
  const customDisplayNames: Record<string, string> = {};
  for (const [id, runner] of Object.entries(customRunners)) {
    customCaps[id] = await runner.capabilities({ probe: true });
    customDisplayNames[id] = runner.displayName;
  }

  if (args.json) {
    const payload = {
      providers: ALL_PROVIDERS.map((id) => ({
        id,
        displayName: RUNNER_REGISTRY[id].displayName,
        ...caps[id],
      })),
      customProviders: Object.entries(customCaps).map(([id, c]) => ({
        id,
        displayName: customDisplayNames[id] ?? id,
        ...c,
      })),
      config: {
        sources: configSources,
        error: configError,
      },
      paths: {
        log: getLogPath(),
        sessions: getSessionsDir(),
      },
    };
    process.stdout.write(JSON.stringify(payload, null, 2) + "\n");
    return configError ? 1 : 0;
  }

  const lines: string[] = [];
  lines.push("codep doctor — provider status\n");
  lines.push(
    "  provider        installed  authenticated  healthy  binary / detail",
  );
  lines.push(
    "  ---------------------------------------------------------------------",
  );
  for (const id of ALL_PROVIDERS) {
    const c = caps[id];
    const runner = RUNNER_REGISTRY[id];
    const extra = c.binPath
      ? c.version
        ? `${c.binPath}  (${c.version})`
        : c.binPath
      : c.detail ?? "";
    lines.push(
      `  ${runner.displayName.padEnd(16)}${icon(c.installed).padEnd(11)}${icon(
        c.authenticated,
      ).padEnd(15)}${icon(c.healthy).padEnd(9)}${extra}`,
    );
  }
  if (Object.keys(customCaps).length > 0) {
    lines.push("");
    lines.push("  custom providers (invocable via --model <id>):");
    for (const [id, c] of Object.entries(customCaps)) {
      const extra = c.binPath
        ? c.version
          ? `${c.binPath}  (${c.version})`
          : c.binPath
        : c.detail ?? "";
      const name = `${id} (${customDisplayNames[id] ?? id})`;
      lines.push(
        `  ${name.padEnd(16)}${icon(c.installed).padEnd(11)}${icon(
          c.authenticated,
        ).padEnd(15)}${icon(c.healthy).padEnd(9)}${extra}`,
      );
    }
  }
  lines.push("");

  lines.push("Configuration:");
  if (configError) {
    lines.push(`  ✗ config error: ${configError}`);
  } else if (configSources.length === 0) {
    lines.push("  (no config files found — using built-in defaults)");
  } else {
    for (const s of configSources) lines.push(`  ✓ ${s}`);
  }
  lines.push(`  log:      ${getLogPath()}`);
  lines.push(`  sessions: ${getSessionsDir()}`);
  lines.push("");

  const missing = ALL_PROVIDERS.filter(
    (id) => !caps[id].installed || !caps[id].authenticated,
  );
  if (missing.length > 0) {
    lines.push("To set up missing providers:");
    for (const id of missing) {
      const g = INSTALL_GUIDES[id];
      lines.push(`  • ${RUNNER_REGISTRY[id].displayName}`);
      if (!caps[id].installed) lines.push(`      install: ${g.install}`);
      if (!caps[id].authenticated) lines.push(`      login:   ${g.login}`);
      lines.push(`      docs:    ${g.docs}`);
    }
    lines.push("");
  }

  process.stdout.write(lines.join("\n") + "\n");
  return 0;
}
