import { createHash } from "node:crypto";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { ProviderId } from "../runners/base.js";
import type { Priority } from "../router/profiles.js";
import type { TaskType } from "../router/taxonomy.js";

export interface RunLogEntry {
  /** ISO-8601 UTC timestamp. */
  ts: string;
  /** SHA-256 of the prompt, first 16 hex chars. Avoids logging raw user prompts. */
  promptHash: string;
  promptBytes: number;
  /** Built-in ProviderId, or a user-defined custom provider id. */
  provider: string;
  taskType: TaskType;
  priority: Priority;
  /** Routing reason (from RouteOutcome). */
  reason: string;
  /** Whether the router had to fall back from its ideal pick. */
  degraded: boolean;
  idealProvider?: ProviderId;  /** Classifier source (heuristic/forced/llm), undefined when --model forces. */
  classifierSource?: "heuristic" | "forced" | "llm";
  classifierConfidence?: number;
  forcedModel: boolean;
  /** CLI flags that affected routing. */
  flags: {
    hasImage?: boolean;
    contextTokens?: number;
    timeoutSec?: number;
    explain?: boolean;
    dryRun?: boolean;
  };
  /** Exit code of the spawned provider CLI. Undefined for explain/dry-run. */
  exitCode?: number;
  timedOut?: boolean;
  durationMs: number;
  /** 1 for the first run, 2+ when this entry is a runtime fallback retry. */
  attempt?: number;
  /** Provider that failed and triggered this retry (set when attempt > 1). */
  previousProvider?: string;
  /** codep version at the time of run. */
  codepVersion: string;
}

function logPath(): string {
  return join(homedir(), ".codep", "runs.jsonl");
}

export function hashPrompt(prompt: string): string {
  return createHash("sha256").update(prompt).digest("hex").slice(0, 16);
}

/**
 * Append a single run entry. Failure to log is not fatal — we swallow and
 * write a warning to stderr so routing never breaks because of disk issues.
 */
export async function appendRunLog(entry: RunLogEntry): Promise<void> {
  const path = logPath();
  try {
    await mkdir(dirname(path), { recursive: true });
    await appendFile(path, JSON.stringify(entry) + "\n", "utf8");
  } catch (err) {
    process.stderr.write(
      `[codep] warn: failed to write run log: ${err instanceof Error ? err.message : String(err)}\n`,
    );
  }
}

/**
 * Read the last N entries from the log. Robust to a partially-written
 * trailing line.
 */
export async function readRunLog(limit: number): Promise<RunLogEntry[]> {
  const entries = await readAllRunLog();
  return entries.slice(-limit);
}

/** Read every valid entry, oldest first. */
export async function readAllRunLog(): Promise<RunLogEntry[]> {
  const path = logPath();
  let contents: string;
  try {
    contents = await readFile(path, "utf8");
  } catch {
    return [];
  }
  const lines = contents.split("\n").filter((l) => l.trim().length > 0);
  const out: RunLogEntry[] = [];
  for (const line of lines) {
    try {
      out.push(JSON.parse(line) as RunLogEntry);
    } catch {
      // skip malformed
    }
  }
  return out;
}

export function getLogPath(): string {
  return logPath();
}
