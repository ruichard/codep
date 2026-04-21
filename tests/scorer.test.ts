import { describe, expect, it } from "vitest";
import { scoreProviders } from "../src/router/scorer.js";

describe("scoreProviders", () => {
  it("ranks by quality at priority=quality", () => {
    const out = scoreProviders(["claude", "codex", "gemini"], "refactor", "quality");
    expect(out[0]!.provider).toBe("claude"); // refactor → claude highest
  });

  it("picks codex for algorithm", () => {
    const out = scoreProviders(["claude", "codex", "gemini"], "algorithm", "quality");
    expect(out[0]!.provider).toBe("codex");
  });

  it("picks gemini for long_context_qa", () => {
    const out = scoreProviders(
      ["claude", "codex", "gemini"],
      "long_context_qa",
      "quality",
    );
    expect(out[0]!.provider).toBe("gemini");
  });

  it("cheap priority applies a larger cost penalty than quality", () => {
    const q = scoreProviders(["claude", "codex", "gemini"], "general_chat", "quality");
    const c = scoreProviders(["claude", "codex", "gemini"], "general_chat", "cheap");
    for (const provider of ["claude", "codex", "gemini"] as const) {
      const qScore = q.find((r) => r.provider === provider)!;
      const cScore = c.find((r) => r.provider === provider)!;
      expect(cScore.costPenalty).toBeGreaterThanOrEqual(qScore.costPenalty);
    }
  });

  it("returns empty array for empty candidate set", () => {
    expect(scoreProviders([], "refactor", "quality")).toEqual([]);
  });
});
