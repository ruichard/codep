import { describe, expect, it } from "vitest";
import { applyHardConstraints } from "../src/router/constraints.js";
import { PROVIDER_PROFILES } from "../src/router/profiles.js";

describe("applyHardConstraints", () => {
  it("passes when no constraints are set", () => {
    const r = applyHardConstraints(["claude", "codex", "gemini"], {});
    expect(r.survivors).toEqual(["claude", "codex", "gemini"]);
    expect(r.rejected).toEqual([]);
  });

  it("prunes providers below the context requirement", () => {
    const big = Math.max(
      PROVIDER_PROFILES.claude.maxContextWindow,
      PROVIDER_PROFILES.codex.maxContextWindow,
      PROVIDER_PROFILES.gemini.maxContextWindow,
    );
    const r = applyHardConstraints(["claude", "codex", "gemini"], {
      contextTokens: big + 1,
    });
    expect(r.survivors).toEqual([]);
    expect(r.rejected.length).toBe(3);
  });

  it("passes when requested context fits all providers", () => {
    const r = applyHardConstraints(["claude", "codex", "gemini"], {
      contextTokens: 10_000,
    });
    expect(r.survivors.length).toBe(3);
  });

  it("respects vision requirement", () => {
    const r = applyHardConstraints(["claude", "codex", "gemini"], {
      needsVision: true,
    });
    // All three flagship families support vision in the current snapshot.
    expect(r.survivors.length).toBeGreaterThan(0);
  });
});
