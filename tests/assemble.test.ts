import { describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assemblePrompt, estimateTokens } from "../src/input/assemble.js";

describe("estimateTokens", () => {
  it("returns 0 for empty string", () => {
    expect(estimateTokens("")).toBe(0);
  });
  it("uses 4 chars per token (rounded up)", () => {
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("abcde")).toBe(2);
    expect(estimateTokens("a".repeat(400))).toBe(100);
  });
});

describe("assemblePrompt", () => {
  it("returns the bare user prompt when no other sources", async () => {
    const r = await assemblePrompt({ userPrompt: "hello" });
    expect(r.prompt).toBe("hello");
    expect(r.sources).toEqual(["argv"]);
    expect(r.contextTokens).toBeGreaterThan(0);
  });

  it("appends stdin when present", async () => {
    const r = await assemblePrompt({
      userPrompt: "explain",
      stdin: "some piped content\n",
    });
    expect(r.prompt).toContain("explain");
    expect(r.prompt).toContain("--- stdin ---");
    expect(r.prompt).toContain("some piped content");
    expect(r.sources).toEqual(["argv", "stdin"]);
  });

  it("appends files when present", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "codep-input-"));
    const p = join(tmp, "sample.ts");
    await writeFile(p, "export const x = 1;\n", "utf8");
    try {
      const r = await assemblePrompt({
        userPrompt: "review this",
        files: [p],
      });
      expect(r.prompt).toContain(`--- file: ${p} ---`);
      expect(r.prompt).toContain("export const x = 1;");
      expect(r.sources).toEqual(["argv", `file:${p}`]);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it("works with stdin-only input (no argv prompt)", async () => {
    const r = await assemblePrompt({ userPrompt: "", stdin: "body" });
    expect(r.prompt).toContain("--- stdin ---");
    expect(r.sources).toEqual(["stdin"]);
  });

  it("returns empty prompt when all sources are empty", async () => {
    const r = await assemblePrompt({ userPrompt: "", stdin: "" });
    expect(r.prompt).toBe("");
    expect(r.sources).toEqual([]);
    expect(r.contextTokens).toBe(0);
  });

  it("prepends a previousExchange block when provided", async () => {
    const r = await assemblePrompt({
      userPrompt: "now add a test",
      previousExchange: {
        id: "abc123",
        prompt: "write a fib function",
        output: "def fib(n): ...",
      },
    });
    expect(r.sources).toEqual(["resume:abc123", "argv"]);
    expect(r.prompt.indexOf("--- previous request ---")).toBeLessThan(
      r.prompt.indexOf("now add a test"),
    );
    expect(r.prompt).toContain("write a fib function");
    expect(r.prompt).toContain("def fib(n): ...");
  });
});
