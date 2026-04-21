import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// We redirect HOME so the logger writes into a throwaway directory.
let tmpHome: string;

beforeEach(async () => {
  tmpHome = await mkdtemp(join(tmpdir(), "codep-log-"));
  // Node's `os.homedir()` reads HOME on POSIX and USERPROFILE on Windows,
  // so stub both to keep this test portable across CI runners.
  vi.stubEnv("HOME", tmpHome);
  vi.stubEnv("USERPROFILE", tmpHome);
  // reload the module with the stubbed HOME
  vi.resetModules();
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(tmpHome, { recursive: true, force: true });
});

describe("run-log", () => {
  it("appends a JSONL entry and reads it back", async () => {
    const mod = await import("../src/log/run-log.js");
    await mod.appendRunLog({
      ts: "2026-04-21T00:00:00.000Z",
      promptHash: "abc",
      promptBytes: 5,
      provider: "codex",
      taskType: "algorithm",
      priority: "quality",
      reason: "top score",
      degraded: false,
      forcedModel: false,
      flags: {},
      exitCode: 0,
      durationMs: 123,
      codepVersion: "test",
    });
    const raw = await readFile(
      join(tmpHome, ".codep", "runs.jsonl"),
      "utf8",
    );
    expect(raw.trim().split("\n")).toHaveLength(1);
    const back = await mod.readRunLog(10);
    expect(back).toHaveLength(1);
    expect(back[0]!.provider).toBe("codex");
  });

  it("returns empty array when log file does not exist", async () => {
    const mod = await import("../src/log/run-log.js");
    const back = await mod.readRunLog(10);
    expect(back).toEqual([]);
  });

  it("skips malformed lines", async () => {
    const mod = await import("../src/log/run-log.js");
    await mod.appendRunLog({
      ts: "2026-04-21T00:00:00.000Z",
      promptHash: "abc",
      promptBytes: 1,
      provider: "gemini",
      taskType: "general_chat",
      priority: "quality",
      reason: "x",
      degraded: false,
      forcedModel: false,
      flags: {},
      durationMs: 1,
      codepVersion: "test",
    });
    // corrupt the file
    const path = join(tmpHome, ".codep", "runs.jsonl");
    const { writeFile } = await import("node:fs/promises");
    const existing = await readFile(path, "utf8");
    await writeFile(path, existing + "{not json\n", "utf8");
    const back = await mod.readRunLog(10);
    expect(back).toHaveLength(1);
  });

  it("hashPrompt is deterministic and 16 chars", async () => {
    const mod = await import("../src/log/run-log.js");
    const a = mod.hashPrompt("hello");
    const b = mod.hashPrompt("hello");
    expect(a).toBe(b);
    expect(a).toHaveLength(16);
    expect(mod.hashPrompt("world")).not.toBe(a);
  });
});
