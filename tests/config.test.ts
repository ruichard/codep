import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../src/config/load.js";

let tmp: string;

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), "codep-cfg-"));
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

describe("loadConfig", () => {
  it("returns empty config when no files exist", async () => {
    const r = await loadConfig({
      cwd: tmp,
      globalPath: join(tmp, "does-not-exist.json"),
    });
    expect(r.config).toEqual({});
    expect(r.sources).toEqual([]);
  });

  it("reads global config", async () => {
    const gp = join(tmp, "global.json");
    await writeFile(gp, JSON.stringify({ priority: "cheap" }), "utf8");
    const r = await loadConfig({ cwd: tmp, globalPath: gp });
    expect(r.config.priority).toBe("cheap");
    expect(r.sources).toEqual([gp]);
  });

  it("project config overrides global", async () => {
    const gp = join(tmp, "global.json");
    await writeFile(
      gp,
      JSON.stringify({ priority: "cheap", denyProviders: ["gemini"] }),
      "utf8",
    );
    const workDir = join(tmp, "proj");
    await mkdir(workDir, { recursive: true });
    await writeFile(
      join(workDir, ".codep.json"),
      JSON.stringify({ priority: "quality" }),
      "utf8",
    );
    const r = await loadConfig({ cwd: workDir, globalPath: gp });
    expect(r.config.priority).toBe("quality");
    expect(r.config.denyProviders).toEqual(["gemini"]); // global preserved
    expect(r.sources).toHaveLength(2);
  });

  it("walks up to find project config", async () => {
    const workDir = join(tmp, "a", "b", "c");
    await mkdir(workDir, { recursive: true });
    await writeFile(
      join(tmp, "a", ".codep.json"),
      JSON.stringify({ priority: "balanced" }),
      "utf8",
    );
    const r = await loadConfig({
      cwd: workDir,
      globalPath: join(tmp, "none.json"),
    });
    expect(r.config.priority).toBe("balanced");
  });

  it("rejects invalid priority", async () => {
    const gp = join(tmp, "global.json");
    await writeFile(gp, JSON.stringify({ priority: "lol" }), "utf8");
    await expect(loadConfig({ cwd: tmp, globalPath: gp })).rejects.toThrow(
      /priority/,
    );
  });

  it("rejects unknown task type in perTaskType", async () => {
    const gp = join(tmp, "global.json");
    await writeFile(
      gp,
      JSON.stringify({ perTaskType: { bogus: "codex" } }),
      "utf8",
    );
    await expect(loadConfig({ cwd: tmp, globalPath: gp })).rejects.toThrow(
      /task type/,
    );
  });

  it("rejects unknown provider in denyProviders", async () => {
    const gp = join(tmp, "global.json");
    await writeFile(
      gp,
      JSON.stringify({ denyProviders: ["claude", "nope"] }),
      "utf8",
    );
    await expect(loadConfig({ cwd: tmp, globalPath: gp })).rejects.toThrow(
      /denyProviders/,
    );
  });
});
