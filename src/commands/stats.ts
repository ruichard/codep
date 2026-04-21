import { getLogPath, readAllRunLog } from "../log/run-log.js";
import { filterEntries, parseSince, summarize } from "../router/stats.js";
import type { ProviderId } from "../runners/base.js";
import { ALL_PROVIDERS } from "../runners/base.js";
import { isTaskType, TASK_TYPES, type TaskType } from "../router/taxonomy.js";

export interface StatsArgs {
  json?: boolean;
  since?: string;
  provider?: string;
  type?: string;
}

function fmtMs(ms: number | undefined): string {
  if (ms === undefined) return "-";
  if (ms < 1_000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1_000).toFixed(1)}s`;
  return `${(ms / 60_000).toFixed(1)}m`;
}

function fmtUsd(n: number): string {
  if (n === 0) return "$0.0000";
  if (n < 0.01) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(2)}`;
}

async function readAll() {
  return readAllRunLog();
}

export async function statsCommand(args: StatsArgs): Promise<number> {
  let since: Date | undefined;
  if (args.since !== undefined) {
    since = parseSince(args.since);
    if (!since) {
      process.stderr.write(
        `codep: invalid --since "${args.since}". Expected e.g. "7d", "24h", "30m", or an ISO date.\n`,
      );
      return 2;
    }
  }
  let provider: ProviderId | undefined;
  if (args.provider !== undefined) {
    if (!ALL_PROVIDERS.includes(args.provider as ProviderId)) {
      process.stderr.write(
        `codep: unknown --provider "${args.provider}". Expected one of: ${ALL_PROVIDERS.join(", ")}\n`,
      );
      return 2;
    }
    provider = args.provider as ProviderId;
  }
  let taskType: TaskType | undefined;
  if (args.type !== undefined) {
    if (!isTaskType(args.type)) {
      process.stderr.write(
        `codep: unknown --type "${args.type}". Expected one of: ${TASK_TYPES.join(", ")}\n`,
      );
      return 2;
    }
    taskType = args.type;
  }

  const all = await readAll();
  const entries = filterEntries(all, { since, provider, taskType });

  if (entries.length === 0) {
    const suffix =
      all.length === 0
        ? `no runs logged yet at ${getLogPath()}`
        : "no runs match the given filters";
    process.stderr.write(`codep: ${suffix}\n`);
    return 0;
  }

  const s = summarize(entries);

  if (args.json) {
    process.stdout.write(JSON.stringify(s, null, 2) + "\n");
    return 0;
  }

  const total = s.totalRuns;
  const pct = (n: number) =>
    total === 0 ? "0%" : `${((n / total) * 100).toFixed(0)}%`;

  const filterNotes: string[] = [];
  if (since) filterNotes.push(`since=${since.toISOString()}`);
  if (provider) filterNotes.push(`provider=${provider}`);
  if (taskType) filterNotes.push(`type=${taskType}`);
  const filterSuffix =
    filterNotes.length > 0 ? `  [${filterNotes.join(", ")}]` : "";

  const lines: string[] = [];
  lines.push(
    `codep stats (${total} runs, ${s.firstTs ?? "?"} → ${s.lastTs ?? "?"})${filterSuffix}`,
  );
  lines.push("");
  lines.push("By provider:");
  for (const [p, n] of Object.entries(s.byProvider)) {
    const cost = s.estimatedCostUsd.byProvider[p as ProviderId];
    lines.push(
      `  ${p.padEnd(7)} ${String(n).padStart(5)}  ${pct(n).padStart(4)}   ${fmtUsd(cost)}`,
    );
  }
  lines.push("");
  lines.push("By task type:");
  const tt = Object.entries(s.byTaskType).sort((a, b) => b[1]! - a[1]!);
  for (const [t, n] of tt) {
    lines.push(`  ${t.padEnd(20)} ${String(n).padStart(5)}  ${pct(n!)}`);
  }
  lines.push("");
  lines.push("Health:");
  lines.push(`  degraded        ${s.degradedCount}  (${pct(s.degradedCount)})`);
  lines.push(`  forced --model  ${s.forcedModelCount}  (${pct(s.forcedModelCount)})`);
  lines.push(`  timeouts        ${s.timeoutCount}`);
  lines.push(`  non-zero exit   ${s.failureCount}`);
  lines.push(`  retries         ${s.retryCount}`);
  lines.push(`  p50 duration    ${fmtMs(s.medianDurationMs)}`);
  lines.push(`  p95 duration    ${fmtMs(s.p95DurationMs)}`);
  lines.push("");
  lines.push(`Estimated cost:   ${fmtUsd(s.estimatedCostUsd.total)}  (rough — assumes ~500 output tokens per run, flagship pricing)`);
  if (s.degradationEdges.length > 0) {
    lines.push("");
    lines.push("Top degradation paths:");
    for (const edge of s.degradationEdges.slice(0, 5)) {
      lines.push(`  ${edge.from} → ${edge.to}  (${edge.count})`);
    }
  }
  process.stdout.write(lines.join("\n") + "\n");
  return 0;
}
