import { describe, expect, it } from "vitest";
import type { Runner, RunnerChunk } from "../src/runners/base.js";
import { runOne } from "../src/commands/plan.js";

function mockRunner(
  id: string,
  chunks: RunnerChunk[],
  delayMs = 0,
): Runner {
  return {
    id,
    displayName: id,
    async capabilities() {
      return { installed: true, authenticated: true };
    },
    async *run() {
      if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
      for (const c of chunks) yield c;
    },
  };
}

describe("plan runOne", () => {
  it("captures stdout and returns exitCode", async () => {
    const r = mockRunner("mock", [
      { type: "stdout", data: "hello " },
      { type: "stdout", data: "world" },
      { type: "exit", code: 0 },
    ]);
    const res = await runOne(r, "p", undefined, process.cwd());
    expect(res.exitCode).toBe(0);
    expect(res.timedOut).toBe(false);
    expect(res.output).toBe("hello world");
    expect(res.error).toBeUndefined();
  });

  it("captures stderr tail", async () => {
    const r = mockRunner("mock", [
      { type: "stderr", data: "warn: thing\n" },
      { type: "exit", code: 2 },
    ]);
    const res = await runOne(r, "p", undefined, process.cwd());
    expect(res.exitCode).toBe(2);
    expect(res.stderrTail).toContain("warn: thing");
  });

  it("propagates timedOut flag", async () => {
    const r = mockRunner("mock", [
      { type: "exit", code: 124, timedOut: true },
    ]);
    const res = await runOne(r, "p", 1000, process.cwd());
    expect(res.timedOut).toBe(true);
    expect(res.exitCode).toBe(124);
  });

  it("catches runner exceptions into error", async () => {
    const runner: Runner = {
      id: "boom",
      displayName: "boom",
      async capabilities() {
        return { installed: true, authenticated: true };
      },
      async *run() {
        yield { type: "stdout", data: "partial" } as RunnerChunk;
        throw new Error("explode");
      },
    };
    const res = await runOne(runner, "p", undefined, process.cwd());
    expect(res.exitCode).toBe(1);
    expect(res.error).toBe("explode");
    expect(res.output).toBe("partial");
  });
});
