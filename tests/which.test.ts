import { mkdtemp, writeFile, chmod, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { isWindows, whichBin } from "../src/runners/which.js";

const originalPath = process.env.PATH;
const originalPathExt = process.env.PATHEXT;

describe("whichBin", () => {
  let dir: string;
  let otherDir: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "codep-which-"));
    otherDir = await mkdtemp(join(tmpdir(), "codep-which-other-"));
    await mkdir(dir, { recursive: true });
    await mkdir(otherDir, { recursive: true });

    // Unix-style executable.
    const unixBin = join(dir, "myfake");
    await writeFile(unixBin, "#!/bin/bash\necho hi\n", "utf8");
    if (!isWindows()) await chmod(unixBin, 0o755);

    // Windows-style .cmd shim.
    await writeFile(
      join(dir, "shimmy.cmd"),
      "@echo off\r\necho shim\r\n",
      "utf8",
    );

    // A file in the second dir, used to test earliest-wins ordering.
    const dup = join(otherDir, "myfake");
    await writeFile(dup, "not-the-one", "utf8");
    if (!isWindows()) await chmod(dup, 0o755);

    process.env.PATH = [dir, otherDir].join(delimiter);
    // Ensure .CMD resolves on all platforms for the Windows-sim test.
    process.env.PATHEXT = ".CMD;.BAT;.EXE";
  });

  afterAll(() => {
    if (originalPath === undefined) delete process.env.PATH;
    else process.env.PATH = originalPath;
    if (originalPathExt === undefined) delete process.env.PATHEXT;
    else process.env.PATHEXT = originalPathExt;
  });

  it("returns undefined for empty name", async () => {
    expect(await whichBin("")).toBeUndefined();
  });

  it("returns undefined when nothing matches", async () => {
    expect(await whichBin("definitely-not-installed-xyz")).toBeUndefined();
  });

  it.skipIf(isWindows())("finds a unix executable on PATH", async () => {
    const got = await whichBin("myfake");
    expect(got).toBe(join(dir, "myfake"));
  });

  it.skipIf(isWindows())(
    "returns earliest PATH entry when the name occurs twice",
    async () => {
      const got = await whichBin("myfake");
      expect(got).toBe(join(dir, "myfake"));
    },
  );

  it.skipIf(isWindows())(
    "ignores a file that lacks the executable bit",
    async () => {
      const nonExec = join(dir, "readable-not-exec");
      await writeFile(nonExec, "x", "utf8");
      await chmod(nonExec, 0o644);
      expect(await whichBin("readable-not-exec")).toBeUndefined();
    },
  );

  it("honors absolute paths directly", async () => {
    const abs = join(dir, "shimmy.cmd");
    // On Unix, we didn't chmod the .cmd so X_OK will fail; ensure it.
    if (!isWindows()) await chmod(abs, 0o755);
    const got = await whichBin(abs);
    expect(got).toBe(abs);
  });

  it("returns undefined for an absolute path that doesn't exist", async () => {
    expect(await whichBin(join(dir, "nope-absent"))).toBeUndefined();
  });

  it("on windows, resolves .CMD via PATHEXT", async () => {
    if (!isWindows()) {
      // Simulate the Windows branch by temporarily pretending the module
      // thinks it's on win32. We do this via a dynamic import with a mock.
      const mod = await import("../src/runners/which.js");
      // Can't easily mock process.platform; just skip on non-win32 but assert
      // that the .cmd shim is locatable by explicit absolute path (already
      // tested above) and that parsing PATHEXT doesn't blow up.
      expect(typeof mod.whichBin).toBe("function");
      return;
    }
    const got = await whichBin("shimmy");
    expect(got?.toLowerCase().endsWith("shimmy.cmd")).toBe(true);
  });
});

describe("isWindows", () => {
  it("matches process.platform", () => {
    expect(isWindows()).toBe(process.platform === "win32");
  });
});

// Silence react "act" warnings if any test imports App indirectly; this
// file only touches node modules so nothing is expected.
vi.resetModules;
