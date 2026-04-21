import { describe, expect, it } from "vitest";
import {
  buildCustomRunner,
  validateCustomProviders,
} from "../src/runners/custom.js";

describe("validateCustomProviders", () => {
  it("returns {} for undefined", () => {
    expect(validateCustomProviders(undefined, "src")).toEqual({});
  });

  it("accepts a minimal valid entry", () => {
    const got = validateCustomProviders(
      {
        aider: { bin: "aider", args: ["--message", "{prompt}"] },
      },
      "src",
    );
    expect(got.aider?.bin).toBe("aider");
    expect(got.aider?.args).toEqual(["--message", "{prompt}"]);
  });

  it("accepts optional fields", () => {
    const got = validateCustomProviders(
      {
        "cursor-agent": {
          displayName: "Cursor Agent",
          bin: "cursor-agent",
          args: ["run"],
          authEnvVars: ["CURSOR_TOKEN"],
          authPaths: [".cursor/auth.json"],
          versionArgs: ["--version"],
        },
      },
      "src",
    );
    expect(got["cursor-agent"]?.displayName).toBe("Cursor Agent");
    expect(got["cursor-agent"]?.authEnvVars).toEqual(["CURSOR_TOKEN"]);
  });

  it("rejects bad shapes", () => {
    expect(() => validateCustomProviders("nope", "src")).toThrow(/object/);
    expect(() =>
      validateCustomProviders({ x: { bin: 1, args: [] } }, "src"),
    ).toThrow(/bin must be a non-empty string/);
    expect(() =>
      validateCustomProviders({ x: { bin: "x", args: [1] } }, "src"),
    ).toThrow(/args must be an array of strings/);
  });

  it("rejects id collision with built-in provider", () => {
    expect(() =>
      validateCustomProviders(
        { codex: { bin: "fake", args: ["-p"] } },
        "src",
      ),
    ).toThrow(/collides with built-in/);
  });

  it("rejects invalid id characters", () => {
    expect(() =>
      validateCustomProviders(
        { "has space": { bin: "x", args: [] } },
        "src",
      ),
    ).toThrow(/must match/);
  });
});

describe("buildCustomRunner", () => {
  it("substitutes {prompt} when present in args", async () => {
    const runner = buildCustomRunner("mockcli", {
      bin: "echo",
      args: ["pre", "{prompt}", "post"],
    });
    expect(runner.id).toBe("mockcli");
    expect(runner.displayName).toBe("mockcli");
  });

  it("appends prompt when no placeholder", () => {
    const runner = buildCustomRunner("mockcli", {
      bin: "echo",
      args: ["--flag"],
    });
    expect(runner.id).toBe("mockcli");
  });
});
