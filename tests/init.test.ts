import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

let tmp: string;
let stdoutBuf = "";
let stderrBuf = "";
const origOut = process.stdout.write.bind(process.stdout);
const origErr = process.stderr.write.bind(process.stderr);

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), "codep-init-"));
  stdoutBuf = "";
  stderrBuf = "";
  process.stdout.write = ((c: string | Uint8Array) => {
    stdoutBuf += typeof c === "string" ? c : c.toString();
    return true;
  }) as typeof process.stdout.write;
  process.stderr.write = ((c: string | Uint8Array) => {
    stderrBuf += typeof c === "string" ? c : c.toString();
    return true;
  }) as typeof process.stderr.write;
  vi.resetModules();
});

afterEach(async () => {
  process.stdout.write = origOut;
  process.stderr.write = origErr;
  await rm(tmp, { recursive: true, force: true });
});

describe("initCommand", () => {
  it("creates a project config file", async () => {
    const { initCommand } = await import("../src/commands/init.js");
    const code = await initCommand({ scope: "project", cwd: tmp });
    expect(code).toBe(0);
    const written = await readFile(join(tmp, ".codep.json"), "utf8");
    const parsed = JSON.parse(written) as { priority: string };
    expect(parsed.priority).toBe("quality");
    expect(stdoutBuf).toMatch(/Wrote/);
  });

  it("refuses to overwrite without --force", async () => {
    const { initCommand } = await import("../src/commands/init.js");
    await initCommand({ scope: "project", cwd: tmp });
    stdoutBuf = "";
    stderrBuf = "";
    const code = await initCommand({ scope: "project", cwd: tmp });
    expect(code).toBe(2);
    expect(stderrBuf).toMatch(/already exists/);
  });

  it("overwrites with --force", async () => {
    const { initCommand } = await import("../src/commands/init.js");
    await initCommand({ scope: "project", cwd: tmp });
    const code = await initCommand({ scope: "project", cwd: tmp, force: true });
    expect(code).toBe(0);
  });

  it("writes a config that passes loadConfig validation", async () => {
    const { initCommand } = await import("../src/commands/init.js");
    const { loadConfig } = await import("../src/config/load.js");
    await initCommand({ scope: "project", cwd: tmp });
    const r = await loadConfig({ cwd: tmp, globalPath: join(tmp, "nope") });
    expect(r.config.priority).toBe("quality");
    expect(r.config.fallbackPolicy).toBe("warn");
  });
});
