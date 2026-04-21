import { createHash, randomBytes } from "node:crypto";
import {
  access,
  constants,
  mkdir,
  readdir,
  readFile,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { TaskType } from "../router/taxonomy.js";

export interface SessionRecord {
  id: string;
  ts: string;
  /** Built-in ProviderId, or a user-defined custom provider id. */
  provider: string;
  taskType: TaskType;
  priority: string;
  prompt: string;
  output: string;
  exitCode: number;
  durationMs: number;
  codepVersion: string;
}

function sessionsDir(): string {
  return join(homedir(), ".codep", "sessions");
}

function sessionPath(id: string): string {
  return join(sessionsDir(), `${id}.json`);
}

export function getSessionsDir(): string {
  return sessionsDir();
}

export function newSessionId(): string {
  const ts = Date.now().toString(36);
  const rand = randomBytes(3).toString("hex");
  return `${ts}-${rand}`;
}

async function exists(p: string): Promise<boolean> {
  try {
    await access(p, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export async function writeSession(rec: SessionRecord): Promise<string> {
  await mkdir(sessionsDir(), { recursive: true });
  const path = sessionPath(rec.id);
  await writeFile(path, JSON.stringify(rec, null, 2), "utf8");
  return path;
}

export async function readSession(id: string): Promise<SessionRecord | undefined> {
  const path = sessionPath(id);
  if (!(await exists(path))) return undefined;
  try {
    const raw = await readFile(path, "utf8");
    return JSON.parse(raw) as SessionRecord;
  } catch {
    return undefined;
  }
}

export async function listSessions(limit = 20): Promise<SessionRecord[]> {
  const dir = sessionsDir();
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }
  const jsons = names.filter((n) => n.endsWith(".json"));
  const withStat = await Promise.all(
    jsons.map(async (n) => {
      const p = join(dir, n);
      try {
        const s = await stat(p);
        return { p, mtime: s.mtimeMs };
      } catch {
        return { p, mtime: 0 };
      }
    }),
  );
  withStat.sort((a, b) => b.mtime - a.mtime);
  const top = withStat.slice(0, limit);
  const out: SessionRecord[] = [];
  for (const { p } of top) {
    try {
      const raw = await readFile(p, "utf8");
      out.push(JSON.parse(raw) as SessionRecord);
    } catch {
      // skip malformed
    }
  }
  return out;
}

export async function latestSessionId(): Promise<string | undefined> {
  const [first] = await listSessions(1);
  return first?.id;
}

/** Delete a single session file. Returns true if it existed and was removed. */
export async function removeSession(id: string): Promise<boolean> {
  const path = sessionPath(id);
  try {
    await unlink(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Remove every session older than `olderThanMs` milliseconds (measured
 * against file mtime). Returns the list of removed session ids.
 */
export async function pruneSessions(olderThanMs: number): Promise<string[]> {
  const dir = sessionsDir();
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }
  const cutoff = Date.now() - olderThanMs;
  const removed: string[] = [];
  for (const n of names) {
    if (!n.endsWith(".json")) continue;
    const p = join(dir, n);
    try {
      const s = await stat(p);
      if (s.mtimeMs < cutoff) {
        await unlink(p);
        removed.push(n.replace(/\.json$/, ""));
      }
    } catch {
      // ignore
    }
  }
  return removed;
}

export function hashPrompt(prompt: string): string {
  return createHash("sha256").update(prompt).digest("hex").slice(0, 16);
}
