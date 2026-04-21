import { describe, expect, it } from "vitest";
import type { Capabilities, ProviderId, Runner, RunnerChunk } from "../src/runners/base.js";
import {
  buildClassifierPrompt,
  classifyWithLlm,
  parseClassifierResponse,
  pickClassifierProvider,
} from "../src/router/llm-classifier.js";

function ok(installed = true, authenticated = true): Capabilities {
  return { installed, authenticated };
}

function availability(
  overrides: Partial<Record<ProviderId, Capabilities>> = {},
): Record<ProviderId, Capabilities> {
  return {
    claude: overrides.claude ?? ok(false, false),
    codex: overrides.codex ?? ok(false, false),
    gemini: overrides.gemini ?? ok(false, false),
  };
}

function mockRunner(id: string, chunks: RunnerChunk[]): Runner {
  return {
    id,
    displayName: id,
    async capabilities() {
      return ok();
    },
    async *run() {
      for (const c of chunks) yield c;
    },
  };
}

describe("pickClassifierProvider", () => {
  it("returns undefined when nothing is available", () => {
    expect(pickClassifierProvider({ availability: availability() })).toBeUndefined();
  });

  it("honors explicit preference when usable", () => {
    expect(
      pickClassifierProvider({
        availability: availability({ claude: ok(), gemini: ok() }),
        preferred: "claude",
      }),
    ).toBe("claude");
  });

  it("falls back to default order when preferred is not usable", () => {
    expect(
      pickClassifierProvider({
        availability: availability({ codex: ok() }),
        preferred: "claude",
      }),
    ).toBe("codex");
  });

  it("picks gemini first by default when available", () => {
    expect(
      pickClassifierProvider({
        availability: availability({ claude: ok(), codex: ok(), gemini: ok() }),
      }),
    ).toBe("gemini");
  });
});

describe("buildClassifierPrompt", () => {
  it("includes the user prompt and the task type list", () => {
    const p = buildClassifierPrompt("refactor this code", {});
    expect(p).toContain("refactor this code");
    expect(p).toContain("taskType:");
    expect(p).toContain("refactor");
    expect(p).toContain("general_chat");
  });

  it("truncates long prompts", () => {
    const long = "x".repeat(5_000);
    const p = buildClassifierPrompt(long, {});
    expect(p.length).toBeLessThan(long.length + 500);
    expect(p).toContain("+3000 chars");
  });

  it("adds image hint when hasImage is set", () => {
    const p = buildClassifierPrompt("look at this", { hasImage: true });
    expect(p).toMatch(/image attachment/i);
  });

  it("adds large-context hint above 20k tokens", () => {
    const p = buildClassifierPrompt("x", { contextTokens: 50_000 });
    expect(p).toMatch(/large context/i);
    expect(p).toContain("50000");
  });
});

describe("parseClassifierResponse", () => {
  it("parses the canonical two-line format", () => {
    const r = parseClassifierResponse("taskType: refactor\nconfidence: 0.9\n");
    expect(r).toEqual({ taskType: "refactor", confidence: 0.9 });
  });

  it("accepts surrounding whitespace and different case", () => {
    const r = parseClassifierResponse("  TASKTYPE : BUGFIX \n  Confidence = 0.55\n");
    expect(r).toEqual({ taskType: "bugfix", confidence: 0.55 });
  });

  it("defaults confidence when only taskType is present", () => {
    const r = parseClassifierResponse("taskType: review\n");
    expect(r?.taskType).toBe("review");
    expect(r?.confidence).toBe(0.7);
  });

  it("falls back to scanning the body for a known type", () => {
    const r = parseClassifierResponse(
      "I think this is an algorithm puzzle, so my answer is algorithm.",
    );
    expect(r?.taskType).toBe("algorithm");
  });

  it("rejects unknown task types", () => {
    expect(parseClassifierResponse("taskType: nonsense\n")).toBeUndefined();
  });

  it("ignores out-of-range confidence values", () => {
    const r = parseClassifierResponse("taskType: refactor\nconfidence: 1.5\n");
    expect(r?.confidence).toBe(0.7);
  });
});

describe("classifyWithLlm", () => {
  it("returns ClassifyResult with source=llm on success", async () => {
    const runner = mockRunner("gemini", [
      { type: "stdout", data: "taskType: bugfix\nconfidence: 0.8\n" },
      { type: "exit", code: 0 },
    ]);
    const r = await classifyWithLlm({ runner, userPrompt: "fix the crash" });
    expect(r.source).toBe("llm");
    expect(r.taskType).toBe("bugfix");
    expect(r.confidence).toBe(0.8);
    expect(r.reason).toContain("llm(gemini)");
  });

  it("throws when the runner exits non-zero", async () => {
    const runner = mockRunner("gemini", [{ type: "exit", code: 3 }]);
    await expect(
      classifyWithLlm({ runner, userPrompt: "x" }),
    ).rejects.toThrow(/exited with code 3/);
  });

  it("throws when the response is unparseable", async () => {
    const runner = mockRunner("gemini", [
      { type: "stdout", data: "no idea\n" },
      { type: "exit", code: 0 },
    ]);
    await expect(
      classifyWithLlm({ runner, userPrompt: "x" }),
    ).rejects.toThrow(/could not parse/);
  });

  it("throws when the runner reports timedOut", async () => {
    const runner = mockRunner("gemini", [
      { type: "exit", code: 124, timedOut: true },
    ]);
    await expect(
      classifyWithLlm({ runner, userPrompt: "x", timeoutMs: 100 }),
    ).rejects.toThrow(/timed out/);
  });
});
