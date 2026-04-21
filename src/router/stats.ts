import type { RunLogEntry } from "../log/run-log.js";
import type { ProviderId } from "../runners/base.js";
import { ALL_PROVIDERS } from "../runners/base.js";
import { PROVIDER_PROFILES } from "./profiles.js";
import type { TaskType } from "./taxonomy.js";

function isBuiltInProvider(id: string): id is ProviderId {
  return (ALL_PROVIDERS as readonly string[]).includes(id);
}

export interface StatsSummary {
  totalRuns: number;
  byProvider: Record<ProviderId, number>;
  byTaskType: Partial<Record<TaskType, number>>;
  degradedCount: number;
  forcedModelCount: number;
  timeoutCount: number;
  failureCount: number; // non-zero exit (excludes timeouts)
  retryCount: number; // entries where attempt > 1
  medianDurationMs: number | undefined;
  p95DurationMs: number | undefined;
  /** Degradation flips: ideal provider → actual provider counts. */
  degradationEdges: Array<{
    from: ProviderId;
    to: ProviderId;
    count: number;
  }>;
  /** Rough cost estimate in USD using each provider's flagship price. */
  estimatedCostUsd: {
    total: number;
    byProvider: Record<ProviderId, number>;
  };
  firstTs?: string;
  lastTs?: string;
}

function percentile(sorted: number[], p: number): number | undefined {
  if (sorted.length === 0) return undefined;
  const idx = Math.min(
    sorted.length - 1,
    Math.max(0, Math.floor(p * (sorted.length - 1))),
  );
  return sorted[idx];
}

/** Heuristic output token count when actual usage isn't logged. */
const ASSUMED_OUTPUT_TOKENS = 500;

function estimateEntryCostUsd(e: RunLogEntry): number {
  if (!isBuiltInProvider(e.provider)) return 0;
  const flagship = PROVIDER_PROFILES[e.provider].flagship;
  const inputTokens = Math.ceil(e.promptBytes / 4);
  const outputTokens = ASSUMED_OUTPUT_TOKENS;
  return (
    (inputTokens * flagship.costPerMInput) / 1_000_000 +
    (outputTokens * flagship.costPerMOutput) / 1_000_000
  );
}

export interface FilterOptions {
  /** Only include entries with ts >= this Date. */
  since?: Date;
  /** Only include entries with ts <= this Date. */
  until?: Date;
  provider?: ProviderId;
  taskType?: TaskType;
}

export function filterEntries(
  entries: readonly RunLogEntry[],
  opts: FilterOptions,
): RunLogEntry[] {
  const sinceMs = opts.since?.getTime();
  const untilMs = opts.until?.getTime();
  return entries.filter((e) => {
    if (opts.provider && e.provider !== opts.provider) return false;
    if (opts.taskType && e.taskType !== opts.taskType) return false;
    if (sinceMs !== undefined || untilMs !== undefined) {
      const t = Date.parse(e.ts);
      if (Number.isNaN(t)) return false;
      if (sinceMs !== undefined && t < sinceMs) return false;
      if (untilMs !== undefined && t > untilMs) return false;
    }
    return true;
  });
}

/**
 * Parse a relative duration (e.g. "7d", "24h", "30m", "15s") or an
 * absolute ISO-8601 date into an absolute `Date` measured from `now`.
 * Returns undefined for invalid inputs.
 */
export function parseSince(input: string, now: Date = new Date()): Date | undefined {
  const trimmed = input.trim();
  if (!trimmed) return undefined;
  const rel = /^(\d+)\s*([smhdw])$/i.exec(trimmed);
  if (rel) {
    const n = Number(rel[1]);
    const unit = rel[2]!.toLowerCase();
    const multipliers: Record<string, number> = {
      s: 1_000,
      m: 60_000,
      h: 3_600_000,
      d: 86_400_000,
      w: 604_800_000,
    };
    return new Date(now.getTime() - n * multipliers[unit]!);
  }
  const abs = Date.parse(trimmed);
  if (Number.isNaN(abs)) return undefined;
  return new Date(abs);
}

export function summarize(entries: readonly RunLogEntry[]): StatsSummary {
  const byProvider: Record<ProviderId, number> = {
    claude: 0,
    codex: 0,
    gemini: 0,
  };
  const costByProvider: Record<ProviderId, number> = {
    claude: 0,
    codex: 0,
    gemini: 0,
  };
  const byTaskType: Partial<Record<TaskType, number>> = {};
  const edgeCounts = new Map<string, number>();
  const durations: number[] = [];
  let degraded = 0;
  let forced = 0;
  let timeouts = 0;
  let failures = 0;
  let retries = 0;
  let totalCost = 0;

  for (const e of entries) {
    if (isBuiltInProvider(e.provider)) byProvider[e.provider] += 1;
    byTaskType[e.taskType] = (byTaskType[e.taskType] ?? 0) + 1;
    if (e.degraded) {
      degraded += 1;
      if (e.idealProvider) {
        const key = `${e.idealProvider}->${e.provider}`;
        edgeCounts.set(key, (edgeCounts.get(key) ?? 0) + 1);
      }
    }
    if (e.forcedModel) forced += 1;
    if (e.timedOut) timeouts += 1;
    else if (e.exitCode !== undefined && e.exitCode !== 0) failures += 1;
    if (e.attempt !== undefined && e.attempt > 1) retries += 1;
    if (typeof e.durationMs === "number") durations.push(e.durationMs);

    const cost = estimateEntryCostUsd(e);
    if (isBuiltInProvider(e.provider)) costByProvider[e.provider] += cost;
    totalCost += cost;
  }

  durations.sort((a, b) => a - b);

  const degradationEdges = [...edgeCounts.entries()]
    .map(([key, count]) => {
      const [from, to] = key.split("->") as [ProviderId, ProviderId];
      return { from, to, count };
    })
    .sort((a, b) => b.count - a.count);

  return {
    totalRuns: entries.length,
    byProvider,
    byTaskType,
    degradedCount: degraded,
    forcedModelCount: forced,
    timeoutCount: timeouts,
    failureCount: failures,
    retryCount: retries,
    medianDurationMs: percentile(durations, 0.5),
    p95DurationMs: percentile(durations, 0.95),
    degradationEdges,
    estimatedCostUsd: {
      total: totalCost,
      byProvider: costByProvider,
    },
    firstTs: entries[0]?.ts,
    lastTs: entries[entries.length - 1]?.ts,
  };
}
