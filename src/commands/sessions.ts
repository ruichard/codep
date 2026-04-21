import {
  getSessionsDir,
  listSessions,
  pruneSessions,
  readSession,
  removeSession,
} from "../session/store.js";
import { parseSince } from "../router/stats.js";

export interface SessionsArgs {
  sub: "list" | "show" | "rm" | "prune";
  id?: string;
  limit?: number;
  json?: boolean;
  olderThan?: string;
  dryRun?: boolean;
}

function fmtMs(ms: number): string {
  if (ms < 1_000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1_000).toFixed(1)}s`;
  return `${(ms / 60_000).toFixed(1)}m`;
}

function truncate(s: string, max: number): string {
  const oneLine = s.replace(/\s+/g, " ").trim();
  return oneLine.length > max ? oneLine.slice(0, max - 1) + "…" : oneLine;
}

export async function sessionsCommand(args: SessionsArgs): Promise<number> {
  if (args.sub === "list") {
    const limit = args.limit ?? 20;
    const list = await listSessions(limit);
    if (list.length === 0) {
      process.stderr.write(
        `codep: no sessions recorded yet at ${getSessionsDir()}\n` +
          `      (pass --save-session on \`codep run\` to start capturing)\n`,
      );
      return 0;
    }
    if (args.json) {
      for (const s of list) process.stdout.write(JSON.stringify(s) + "\n");
      return 0;
    }
    const header = ["ID", "TIME", "PROVIDER", "TYPE", "EXIT", "DUR", "PROMPT"];
    const rows = list.map((s) => [
      s.id,
      s.ts.replace("T", " ").replace(/\.\d+Z$/, "Z"),
      s.provider,
      s.taskType,
      String(s.exitCode),
      fmtMs(s.durationMs),
      truncate(s.prompt, 60),
    ]);
    const widths = header.map((h, i) =>
      Math.max(h.length, ...rows.map((r) => r[i]!.length)),
    );
    const pad = (cells: string[]) =>
      cells.map((c, i) => c.padEnd(widths[i]!)).join("  ");
    process.stdout.write(pad(header) + "\n");
    process.stdout.write(widths.map((w) => "-".repeat(w)).join("  ") + "\n");
    for (const r of rows) process.stdout.write(pad(r) + "\n");
    return 0;
  }

  // show
  if (!args.id) {
    process.stderr.write("codep: `sessions show` requires an <id>.\n");
    return 2;
  }
  const rec = await readSession(args.id);
  if (!rec) {
    process.stderr.write(`codep: session \`${args.id}\` not found.\n`);
    return 2;
  }
  if (args.json) {
    process.stdout.write(JSON.stringify(rec, null, 2) + "\n");
    return 0;
  }
  process.stdout.write(
    `session   ${rec.id}\n` +
      `time      ${rec.ts}\n` +
      `provider  ${rec.provider}\n` +
      `type      ${rec.taskType}\n` +
      `priority  ${rec.priority}\n` +
      `exit      ${rec.exitCode}\n` +
      `duration  ${fmtMs(rec.durationMs)}\n` +
      `\n--- prompt ---\n${rec.prompt}\n` +
      `\n--- output ---\n${rec.output}\n`,
  );
  return 0;
}

export async function sessionsRm(id: string): Promise<number> {
  const ok = await removeSession(id);
  if (!ok) {
    process.stderr.write(`codep: session \`${id}\` not found.\n`);
    return 2;
  }
  process.stdout.write(`removed ${id}\n`);
  return 0;
}

export async function sessionsPrune(opts: {
  olderThan: string;
  dryRun?: boolean;
}): Promise<number> {
  const cutoffDate = parseSince(opts.olderThan);
  if (!cutoffDate) {
    process.stderr.write(
      `codep: invalid --older-than "${opts.olderThan}". Expected e.g. "30d", "7d", or an ISO date.\n`,
    );
    return 2;
  }
  const olderThanMs = Date.now() - cutoffDate.getTime();
  if (opts.dryRun) {
    const all = await listSessions(10_000);
    const cutoffMs = cutoffDate.getTime();
    const doomed = all.filter((s) => Date.parse(s.ts) < cutoffMs);
    process.stdout.write(
      `would prune ${doomed.length} session(s) older than ${cutoffDate.toISOString()}\n`,
    );
    for (const s of doomed) process.stdout.write(`  ${s.id}  ${s.ts}\n`);
    return 0;
  }
  const removed = await pruneSessions(olderThanMs);
  process.stdout.write(`pruned ${removed.length} session(s)\n`);
  return 0;
}
