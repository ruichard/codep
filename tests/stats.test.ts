import { describe, expect, it } from "vitest";
import type { RunLogEntry } from "../src/log/run-log.js";
import { filterEntries, parseSince, summarize } from "../src/router/stats.js";

function entry(overrides: Partial<RunLogEntry> = {}): RunLogEntry {
  return {
    ts: "2026-04-21T00:00:00.000Z",
    promptHash: "a".repeat(16),
    promptBytes: 10,
    provider: "codex",
    taskType: "general_chat",
    priority: "quality",
    reason: "t",
    degraded: false,
    forcedModel: false,
    flags: {},
    durationMs: 100,
    codepVersion: "test",
    exitCode: 0,
    ...overrides,
  };
}

describe("summarize", () => {
  it("handles empty input", () => {
    const s = summarize([]);
    expect(s.totalRuns).toBe(0);
    expect(s.byProvider).toEqual({ claude: 0, codex: 0, gemini: 0 });
    expect(s.medianDurationMs).toBeUndefined();
  });

  it("counts providers, task types, degradations, forced", () => {
    const s = summarize([
      entry({ provider: "codex", taskType: "algorithm" }),
      entry({ provider: "gemini", taskType: "long_context_qa" }),
      entry({
        provider: "gemini",
        taskType: "refactor",
        degraded: true,
        idealProvider: "claude",
      }),
      entry({ provider: "codex", forcedModel: true }),
    ]);
    expect(s.totalRuns).toBe(4);
    expect(s.byProvider).toEqual({ claude: 0, codex: 2, gemini: 2 });
    expect(s.byTaskType.algorithm).toBe(1);
    expect(s.byTaskType.long_context_qa).toBe(1);
    expect(s.degradedCount).toBe(1);
    expect(s.forcedModelCount).toBe(1);
    expect(s.degradationEdges).toEqual([
      { from: "claude", to: "gemini", count: 1 },
    ]);
  });

  it("counts timeouts and non-zero exits separately", () => {
    const s = summarize([
      entry({ timedOut: true, exitCode: 143 }),
      entry({ exitCode: 1 }),
      entry({ exitCode: 0 }),
    ]);
    expect(s.timeoutCount).toBe(1);
    expect(s.failureCount).toBe(1);
  });

  it("computes p50 and p95 durations", () => {
    const durations = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
    const s = summarize(durations.map((d) => entry({ durationMs: d })));
    expect(s.medianDurationMs).toBeDefined();
    expect(s.p95DurationMs).toBeDefined();
    expect(s.medianDurationMs!).toBeLessThanOrEqual(60);
    expect(s.p95DurationMs!).toBeGreaterThanOrEqual(80);
  });

  it("sorts degradation edges by count desc", () => {
    const s = summarize([
      entry({ degraded: true, idealProvider: "claude", provider: "codex" }),
      entry({ degraded: true, idealProvider: "claude", provider: "codex" }),
      entry({ degraded: true, idealProvider: "claude", provider: "gemini" }),
    ]);
    expect(s.degradationEdges[0]).toEqual({
      from: "claude",
      to: "codex",
      count: 2,
    });
    expect(s.degradationEdges[1]).toEqual({
      from: "claude",
      to: "gemini",
      count: 1,
    });
  });

  it("counts retries and estimates cost", () => {
    const s = summarize([
      entry({ provider: "codex", promptBytes: 4000 }),
      entry({ provider: "codex", attempt: 2, previousProvider: "claude" }),
    ]);
    expect(s.retryCount).toBe(1);
    expect(s.estimatedCostUsd.total).toBeGreaterThan(0);
    expect(s.estimatedCostUsd.byProvider.codex).toBeGreaterThan(0);
    expect(s.estimatedCostUsd.byProvider.claude).toBe(0);
  });
});

describe("parseSince", () => {
  const now = new Date("2026-04-21T12:00:00.000Z");
  it("parses relative durations", () => {
    expect(parseSince("1h", now)!.toISOString()).toBe("2026-04-21T11:00:00.000Z");
    expect(parseSince("7d", now)!.toISOString()).toBe("2026-04-14T12:00:00.000Z");
    expect(parseSince("30m", now)!.toISOString()).toBe("2026-04-21T11:30:00.000Z");
    expect(parseSince("2w", now)!.toISOString()).toBe("2026-04-07T12:00:00.000Z");
  });
  it("parses ISO dates", () => {
    expect(parseSince("2026-04-20T00:00:00Z", now)!.toISOString()).toBe(
      "2026-04-20T00:00:00.000Z",
    );
  });
  it("returns undefined for junk", () => {
    expect(parseSince("not-a-date", now)).toBeUndefined();
    expect(parseSince("", now)).toBeUndefined();
  });
});

describe("filterEntries", () => {
  const mk = (ts: string, provider: RunLogEntry["provider"] = "codex") =>
    ({
      ts,
      promptHash: "a".repeat(16),
      promptBytes: 10,
      provider,
      taskType: "general_chat",
      priority: "quality",
      reason: "t",
      degraded: false,
      forcedModel: false,
      flags: {},
      durationMs: 10,
      codepVersion: "test",
      exitCode: 0,
    }) satisfies RunLogEntry;

  it("filters by since/provider/taskType", () => {
    const all = [
      mk("2026-04-20T12:00:00Z", "claude"),
      mk("2026-04-21T10:00:00Z", "codex"),
      mk("2026-04-21T11:00:00Z", "gemini"),
    ];
    const filtered = filterEntries(all, {
      since: new Date("2026-04-21T00:00:00Z"),
      provider: "codex",
    });
    expect(filtered).toHaveLength(1);
    expect(filtered[0]!.provider).toBe("codex");
  });
});
