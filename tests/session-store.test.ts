import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// We mock homedir() before importing the store so it points to a temp dir.
let tmpHome: string;

vi.mock("node:os", async () => {
  const actual = await vi.importActual<typeof import("node:os")>("node:os");
  return {
    ...actual,
    homedir: () => tmpHome,
  };
});

describe("session store", () => {
  beforeEach(() => {
    tmpHome = mkdtempSync(join(tmpdir(), "codep-session-"));
  });
  afterEach(() => {
    rmSync(tmpHome, { recursive: true, force: true });
  });

  it("writes, reads, and lists sessions newest-first", async () => {
    const { writeSession, readSession, listSessions, latestSessionId } =
      await import("../src/session/store.js");

    const older = {
      id: "a1",
      ts: "2026-04-20T00:00:00.000Z",
      provider: "codex" as const,
      taskType: "general_chat" as const,
      priority: "quality",
      prompt: "hello",
      output: "hi there",
      exitCode: 0,
      durationMs: 100,
      codepVersion: "test",
    };
    await writeSession(older);
    // Force a time gap so mtime differs.
    await new Promise((r) => setTimeout(r, 10));
    const newer = { ...older, id: "b2", ts: "2026-04-21T00:00:00.000Z" };
    await writeSession(newer);

    const back = await readSession("a1");
    expect(back?.prompt).toBe("hello");

    const list = await listSessions(10);
    expect(list.map((s) => s.id)).toEqual(["b2", "a1"]);

    const latest = await latestSessionId();
    expect(latest).toBe("b2");
  });

  it("returns undefined for a missing id and empty list with no dir", async () => {
    const { readSession, listSessions } = await import(
      "../src/session/store.js"
    );
    expect(await readSession("nope")).toBeUndefined();
    expect(await listSessions(5)).toEqual([]);
  });

  it("removes a single session and reports not-found on second call", async () => {
    const { writeSession, removeSession, readSession } = await import(
      "../src/session/store.js"
    );
    await writeSession({
      id: "solo",
      ts: "2026-04-21T00:00:00.000Z",
      provider: "codex",
      taskType: "general_chat",
      priority: "quality",
      prompt: "hi",
      output: "ok",
      exitCode: 0,
      durationMs: 1,
      codepVersion: "test",
    });
    expect(await readSession("solo")).toBeDefined();
    expect(await removeSession("solo")).toBe(true);
    expect(await readSession("solo")).toBeUndefined();
    expect(await removeSession("solo")).toBe(false);
  });

  it("prunes sessions older than a threshold", async () => {
    const { writeSession, pruneSessions, listSessions } = await import(
      "../src/session/store.js"
    );
    // Write two sessions, then manually backdate one via fs.utimes.
    const { utimes } = await import("node:fs/promises");
    const { join } = await import("node:path");
    await writeSession({
      id: "old",
      ts: "2026-03-01T00:00:00.000Z",
      provider: "codex",
      taskType: "general_chat",
      priority: "quality",
      prompt: "old",
      output: "",
      exitCode: 0,
      durationMs: 1,
      codepVersion: "test",
    });
    const oldPath = join(tmpHome, ".codep", "sessions", "old.json");
    const pastSec = Math.floor(Date.now() / 1000) - 60 * 60 * 24 * 45; // 45d ago
    await utimes(oldPath, pastSec, pastSec);
    await writeSession({
      id: "new",
      ts: "2026-04-21T00:00:00.000Z",
      provider: "codex",
      taskType: "general_chat",
      priority: "quality",
      prompt: "new",
      output: "",
      exitCode: 0,
      durationMs: 1,
      codepVersion: "test",
    });
    const removed = await pruneSessions(30 * 24 * 60 * 60 * 1000); // 30d
    expect(removed).toEqual(["old"]);
    const remaining = await listSessions(10);
    expect(remaining.map((s) => s.id)).toEqual(["new"]);
  });
});
