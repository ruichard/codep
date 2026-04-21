import { describe, expect, it } from "vitest";
import type { Capabilities, ProviderId } from "../src/runners/base.js";
import { route } from "../src/router/pipeline.js";

function caps(overrides: Partial<Record<ProviderId, Partial<Capabilities>>> = {}) {
  const base = (id: ProviderId): Capabilities => ({
    installed: true,
    authenticated: true,
    ...(overrides[id] ?? {}),
  });
  return {
    claude: base("claude"),
    codex: base("codex"),
    gemini: base("gemini"),
  };
}

describe("route", () => {
  it("short-circuits on forced provider", () => {
    const r = route({
      prompt: "x",
      forcedProvider: "codex",
      priority: "quality",
      constraints: {},
      availability: caps(),
      fallbackPolicy: "warn",
    });
    expect(r.kind).toBe("ok");
    if (r.kind === "ok") {
      expect(r.provider).toBe("codex");
      expect(r.reason).toBe("forced by --model");
    }
  });

  it("rejects forced provider that isn't installed", () => {
    const r = route({
      prompt: "x",
      forcedProvider: "claude",
      priority: "quality",
      constraints: {},
      availability: caps({ claude: { installed: false, authenticated: false } }),
      fallbackPolicy: "warn",
    });
    expect(r.kind).toBe("forced_unavailable");
  });

  it("returns no_providers when nothing is available", () => {
    const empty = caps({
      claude: { installed: false, authenticated: false },
      codex: { installed: false, authenticated: false },
      gemini: { installed: false, authenticated: false },
    });
    const r = route({
      prompt: "x",
      priority: "quality",
      constraints: {},
      availability: empty,
      fallbackPolicy: "warn",
    });
    expect(r.kind).toBe("no_providers");
  });

  it("picks claude for refactor when all providers available", () => {
    const r = route({
      prompt: "x",
      taskType: "refactor",
      priority: "quality",
      constraints: {},
      availability: caps(),
      fallbackPolicy: "warn",
    });
    expect(r.kind).toBe("ok");
    if (r.kind === "ok") expect(r.provider).toBe("claude");
  });

  it("flags degraded when ideal provider is unavailable", () => {
    const r = route({
      prompt: "x",
      taskType: "refactor",
      priority: "quality",
      constraints: {},
      availability: caps({ claude: { installed: false, authenticated: false } }),
      fallbackPolicy: "warn",
    });
    expect(r.kind).toBe("ok");
    if (r.kind === "ok") {
      expect(r.degraded).toBe(true);
      expect(r.idealProvider).toBe("claude");
      expect(r.provider).not.toBe("claude");
    }
  });

  it("fails when degraded and policy=fail", () => {
    const r = route({
      prompt: "x",
      taskType: "refactor",
      priority: "quality",
      constraints: {},
      availability: caps({ claude: { installed: false, authenticated: false } }),
      fallbackPolicy: "fail",
    });
    expect(r.kind).toBe("ideal_unavailable_fail");
  });

  it("reports constraints_empty when all providers pruned", () => {
    const r = route({
      prompt: "x",
      priority: "quality",
      constraints: { contextTokens: 9_999_999 },
      availability: caps(),
      fallbackPolicy: "warn",
    });
    expect(r.kind).toBe("constraints_empty");
  });

  it("denyProviders excludes a provider from routing", () => {
    const r = route({
      prompt: "x",
      taskType: "refactor",
      priority: "quality",
      constraints: {},
      availability: caps(),
      fallbackPolicy: "warn",
      denyProviders: ["claude"],
    });
    expect(r.kind).toBe("ok");
    if (r.kind === "ok") expect(r.provider).not.toBe("claude");
  });

  it("allowProviders limits routing to the allowed set", () => {
    const r = route({
      prompt: "x",
      taskType: "algorithm",
      priority: "quality",
      constraints: {},
      availability: caps(),
      fallbackPolicy: "warn",
      allowProviders: ["gemini"],
    });
    expect(r.kind).toBe("ok");
    if (r.kind === "ok") expect(r.provider).toBe("gemini");
  });

  it("perTaskType pins a provider when usable", () => {
    const r = route({
      prompt: "x",
      taskType: "algorithm",
      priority: "quality",
      constraints: {},
      availability: caps(),
      fallbackPolicy: "warn",
      perTaskType: { algorithm: "gemini" },
    });
    expect(r.kind).toBe("ok");
    if (r.kind === "ok") {
      expect(r.provider).toBe("gemini");
      expect(r.reason).toContain("pinned");
    }
  });

  it("perTaskType falls back to scoring when pinned provider is unavailable", () => {
    const r = route({
      prompt: "x",
      taskType: "algorithm",
      priority: "quality",
      constraints: {},
      availability: caps({ claude: { installed: false, authenticated: false } }),
      fallbackPolicy: "warn",
      perTaskType: { algorithm: "claude" },
    });
    expect(r.kind).toBe("ok");
    if (r.kind === "ok") expect(r.provider).not.toBe("claude");
  });

  it("reports no_providers with config-exclusion reason when all are denied", () => {
    const r = route({
      prompt: "x",
      priority: "quality",
      constraints: {},
      availability: caps(),
      fallbackPolicy: "warn",
      denyProviders: ["claude", "codex", "gemini"],
    });
    expect(r.kind).toBe("no_providers");
    if (r.kind === "no_providers") expect(r.reason).toMatch(/config/);
  });
});
