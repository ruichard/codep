import { performance } from "node:perf_hooks";
import type { Runner } from "../runners/base.js";
import type { ProviderId } from "../runners/base.js";
import { ALL_PROVIDERS } from "../runners/base.js";
import { RUNNER_REGISTRY } from "../runners/registry.js";
import { detectAll } from "../router/availability.js";
import { usableProviders } from "../router/availability.js";
import { loadConfig } from "../config/load.js";
import { buildCustomRunners } from "../runners/custom.js";
import { appendRunLog, hashPrompt } from "../log/run-log.js";
import type { RunLogEntry } from "../log/run-log.js";
import { newSessionId, writeSession } from "../session/store.js";
import { CODEP_VERSION } from "../version.js";

export interface PlanArgs {
  prompt: string;
  /** Explicit provider ids to run. If omitted, use all installed+authed built-ins. */
  providers?: string[];
  timeoutSec?: number;
  cwd?: string;
  /** Save each provider's output as a session. */
  saveSession?: boolean;
  /** Emit full JSON with captured outputs. */
  json?: boolean;
  /** Pre-truncate preview excerpts to this many chars per provider. */
  previewChars?: number;
}

interface PlanResult {
  providerId: string;
  displayName: string;
  exitCode: number;
  timedOut: boolean;
  durationMs: number;
  output: string;
  stderrTail: string;
  error?: string;
  sessionId?: string;
}

/** Exposed for tests. */
export async function runOne(
  runner: Runner,
  prompt: string,
  timeoutMs: number | undefined,
  cwd: string,
): Promise<{
  exitCode: number;
  timedOut: boolean;
  durationMs: number;
  output: string;
  stderrTail: string;
  error?: string;
}> {
  const controller = new AbortController();
  const start = performance.now();
  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];
  let exitCode = 0;
  let timedOut = false;

  try {
    for await (const chunk of runner.run(prompt, {
      cwd,
      signal: controller.signal,
      timeoutMs,
    })) {
      if (chunk.type === "stdout") stdoutChunks.push(chunk.data);
      else if (chunk.type === "stderr") stderrChunks.push(chunk.data);
      else if (chunk.type === "exit") {
        exitCode = chunk.code;
        timedOut = !!chunk.timedOut;
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      exitCode: 1,
      timedOut: false,
      durationMs: Math.round(performance.now() - start),
      output: stdoutChunks.join(""),
      stderrTail: stderrChunks.join("").slice(-400),
      error: msg,
    };
  }

  return {
    exitCode,
    timedOut,
    durationMs: Math.round(performance.now() - start),
    output: stdoutChunks.join(""),
    stderrTail: stderrChunks.join("").slice(-400),
  };
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n) + `\n… (+${s.length - n} more chars)`;
}

function formatDuration(ms: number): string {
  if (ms < 1_000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1_000).toFixed(1)}s`;
  return `${(ms / 60_000).toFixed(1)}m`;
}

export async function planCommand(args: PlanArgs): Promise<number> {
  if (!args.prompt || !args.prompt.trim()) {
    process.stderr.write("codep plan: prompt is required\n");
    return 2;
  }

  const { config } = await loadConfig();
  const customRunners = buildCustomRunners(config.providers ?? {});

  // Resolve provider set.
  let selectedIds: string[];
  if (args.providers && args.providers.length > 0) {
    selectedIds = args.providers;
    for (const id of selectedIds) {
      const isBuiltin = (ALL_PROVIDERS as readonly string[]).includes(id);
      if (!isBuiltin && !customRunners[id]) {
        const known = [...ALL_PROVIDERS, ...Object.keys(customRunners)].join(
          ", ",
        );
        process.stderr.write(
          `codep plan: unknown provider "${id}". Expected one of: ${known}\n`,
        );
        return 2;
      }
    }
  } else {
    const caps = await detectAll({ probe: false });
    selectedIds = usableProviders(caps);
    if (selectedIds.length === 0) {
      process.stderr.write(
        "codep plan: no installed+authenticated providers. Run `codep doctor` or pass --providers.\n",
      );
      return 2;
    }
  }

  if (selectedIds.length < 2 && (!args.providers || args.providers.length < 2)) {
    process.stderr.write(
      `[codep] note: plan mode with only ${selectedIds.length} provider(s) — consider passing --providers.\n`,
    );
  }

  const runners: Array<{ id: string; runner: Runner }> = selectedIds.map(
    (id) => {
      const builtin = (ALL_PROVIDERS as readonly string[]).includes(id);
      return {
        id,
        runner: builtin
          ? RUNNER_REGISTRY[id as ProviderId]
          : (customRunners[id] as Runner),
      };
    },
  );

  if (!args.json) {
    process.stderr.write(
      `[codep] plan · prompt=${JSON.stringify(args.prompt.length > 80 ? args.prompt.slice(0, 77) + "..." : args.prompt)} · providers=${selectedIds.join(",")}\n`,
    );
    process.stderr.write("[codep] running in parallel…\n");
  }

  const timeoutMs = args.timeoutSec ? args.timeoutSec * 1000 : undefined;
  const cwd = args.cwd ?? process.cwd();
  const promptHash = hashPrompt(args.prompt);
  const promptBytes = Buffer.byteLength(args.prompt, "utf8");
  const startedAt = new Date();

  const results: PlanResult[] = await Promise.all(
    runners.map(async ({ id, runner }) => {
      const base = await runOne(runner, args.prompt, timeoutMs, cwd);
      const result: PlanResult = {
        providerId: id,
        displayName: runner.displayName,
        ...base,
      };

      // Log each run so `codep logs` / `stats` reflects plan activity.
      const entry: RunLogEntry = {
        ts: new Date().toISOString(),
        promptHash,
        promptBytes,
        provider: id,
        taskType: "general_chat",
        priority: "balanced",
        reason: "plan mode (parallel)",
        degraded: false,
        forcedModel: true,
        flags: { timeoutSec: args.timeoutSec },
        exitCode: result.exitCode,
        timedOut: result.timedOut || undefined,
        durationMs: result.durationMs,
        codepVersion: CODEP_VERSION,
      };
      await appendRunLog(entry);

      if (args.saveSession) {
        try {
          const sid = newSessionId();
          await writeSession({
            id: sid,
            ts: startedAt.toISOString(),
            provider: id,
            taskType: "general_chat",
            priority: "balanced",
            prompt: args.prompt,
            output: result.output,
            exitCode: result.exitCode,
            durationMs: result.durationMs,
            codepVersion: CODEP_VERSION,
          });
          result.sessionId = sid;
        } catch {
          // non-fatal
        }
      }

      return result;
    }),
  );

  if (args.json) {
    process.stdout.write(
      JSON.stringify(
        {
          prompt: args.prompt,
          promptHash,
          startedAt: startedAt.toISOString(),
          results: results.map((r) => ({
            provider: r.providerId,
            displayName: r.displayName,
            exitCode: r.exitCode,
            timedOut: r.timedOut,
            durationMs: r.durationMs,
            output: r.output,
            error: r.error,
            sessionId: r.sessionId,
          })),
        },
        null,
        2,
      ) + "\n",
    );
    const anyFail = results.some((r) => r.exitCode !== 0);
    return anyFail ? 1 : 0;
  }

  // Human summary.
  const previewChars = args.previewChars ?? 800;
  process.stdout.write("\n");
  process.stdout.write("=== plan results ===\n\n");
  for (const r of results) {
    const status = r.timedOut
      ? "TIMEOUT"
      : r.exitCode === 0
        ? "ok"
        : `exit ${r.exitCode}`;
    const header = `── ${r.providerId} (${r.displayName}) · ${status} · ${formatDuration(r.durationMs)}${r.sessionId ? ` · session ${r.sessionId}` : ""} ──`;
    process.stdout.write(header + "\n");
    if (r.error) {
      process.stdout.write(`  error: ${r.error}\n`);
    }
    if (r.output.trim().length === 0) {
      if (r.stderrTail.trim().length > 0) {
        process.stdout.write(`  (no stdout; last stderr:)\n`);
        process.stdout.write(
          r.stderrTail
            .split("\n")
            .map((l) => `    ${l}`)
            .join("\n") + "\n",
        );
      } else {
        process.stdout.write("  (no output)\n");
      }
    } else {
      process.stdout.write(truncate(r.output, previewChars) + "\n");
    }
    process.stdout.write("\n");
  }

  // Quick comparison line.
  const okResults = results.filter((r) => r.exitCode === 0 && !r.timedOut);
  if (okResults.length > 0) {
    const fastest = okResults.reduce((a, b) =>
      a.durationMs <= b.durationMs ? a : b,
    );
    const longest = okResults.reduce((a, b) =>
      a.output.length >= b.output.length ? a : b,
    );
    process.stdout.write(
      `Comparison: fastest=${fastest.providerId} (${formatDuration(fastest.durationMs)}) · longest-output=${longest.providerId} (${longest.output.length}B)\n`,
    );
  }
  const failed = results.filter((r) => r.exitCode !== 0 || r.timedOut);
  if (failed.length > 0) {
    process.stdout.write(
      `Failures: ${failed.map((r) => r.providerId).join(", ")}\n`,
    );
  }

  const anyFail = results.some((r) => r.exitCode !== 0);
  return anyFail ? 1 : 0;
}
