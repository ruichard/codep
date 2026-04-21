import { describe, expect, it } from "vitest";
import { MODELS } from "../src/config/generated/models.generated.js";
import { PROVIDER_PROFILES } from "../src/router/profiles.js";
import { ALL_PROVIDERS } from "../src/runners/base.js";

describe("models snapshot", () => {
  it("contains at least one model per provider", () => {
    for (const p of ALL_PROVIDERS) {
      expect(MODELS.some((m) => m.provider === p)).toBe(true);
    }
  });

  it("each provider has a flagship matching its MODELS entry", () => {
    for (const p of ALL_PROVIDERS) {
      const prof = PROVIDER_PROFILES[p];
      expect(prof.flagship.provider).toBe(p);
      expect(MODELS).toContain(prof.flagship);
    }
  });

  it("context windows are positive", () => {
    for (const m of MODELS) expect(m.contextWindow).toBeGreaterThan(0);
  });

  it("cost fields are non-negative", () => {
    for (const m of MODELS) {
      expect(m.costPerMInput).toBeGreaterThanOrEqual(0);
      expect(m.costPerMOutput).toBeGreaterThanOrEqual(0);
    }
  });
});
