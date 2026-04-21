import { getLogPath, readAllRunLog } from "../log/run-log.js";
import { filterEntries, parseSince } from "../router/stats.js";
import type { ProviderId } from "../runners/base.js";
import { ALL_PROVIDERS } from "../runners/base.js";
import { isTaskType, TASK_TYPES, type TaskType } from "../router/taxonomy.js";

export interface LogsArgs {
  limit: number;
  json?: boolean;
  since?: string;
  provider?: string;
  type?: string;
}

function fmtDuration(ms: number): string {
  if (ms < 1_000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1_000).toFixed(1)}s`;
  return `${(ms / 60_000).toFixed(1)}m`;
}

export async function logsCommand(args: LogsArgs): Promise<number> {
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

  const all = await readAllRunLog();
  const filtered = filterEntries(all, { since, provider, taskType });
  const entries = filtered.slice(-args.limit);

  if (entries.length === 0) {
    const suffix =
      all.length === 0
        ? `no runs logged yet at ${getLogPath()}`
        : "no runs match the given filters";
    process.stderr.write(`codep: ${suffix}\n`);
    return 0;
  }

  if (args.json) {
    for (const e of entries) process.stdout.write(JSON.stringify(e) + "\n");
    return 0;
  }

  const header = [
    "TIME",
    "PROVIDER",
    "TYPE",
    "PRIO",
    "EXIT",
    "DUR",
    "REASON",
  ];
  const rows = entries.map((e) => [
    e.ts.replace("T", " ").replace(/\.\d+Z$/, "Z"),
    e.provider +
      (e.degraded ? "*" : "") +
      (e.forcedModel ? "!" : "") +
      (e.attempt && e.attempt > 1 ? `#${e.attempt}` : ""),
    e.taskType,
    e.priority,
    e.exitCode === undefined ? "-" : e.timedOut ? "TIMEOUT" : String(e.exitCode),
    fmtDuration(e.durationMs),
    e.reason,
  ]);

  const widths = header.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => r[i]!.length)),
  );
  const pad = (cells: string[]) =>
    cells.map((c, i) => c.padEnd(widths[i]!)).join("  ");

  process.stdout.write(pad(header) + "\n");
  process.stdout.write(widths.map((w) => "-".repeat(w)).join("  ") + "\n");
  for (const r of rows) process.stdout.write(pad(r) + "\n");

  const legend: string[] = [];
  if (entries.some((e) => e.degraded)) legend.push("* degraded (ideal provider unavailable)");
  if (entries.some((e) => e.forcedModel)) legend.push("! --model override");
  if (entries.some((e) => e.attempt && e.attempt > 1)) legend.push("#N runtime fallback attempt N");
  if (legend.length > 0) {
    process.stdout.write("\n" + legend.join("\n") + "\n");
  }
  return 0;
}
