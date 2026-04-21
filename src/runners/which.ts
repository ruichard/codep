import { access, constants, stat } from "node:fs/promises";
import { delimiter, isAbsolute, join, resolve } from "node:path";
import { platform } from "node:process";

/**
 * Cross-platform `which`. Resolves an executable name by scanning `PATH`
 * (and, on Windows, trying `PATHEXT` extensions for each candidate).
 *
 * We intentionally do NOT shell out to `which` / `where` so the same code
 * works on macOS, Linux, and Windows without spawning a subprocess.
 *
 * Returns the absolute path of the first matching executable, or undefined
 * when nothing is found.
 */
export async function whichBin(bin: string): Promise<string | undefined> {
  if (bin.length === 0) return undefined;

  // Absolute or explicit-relative paths bypass PATH resolution entirely.
  if (isAbsolute(bin) || bin.startsWith("./") || bin.startsWith("../")) {
    return (await isExecutableFile(bin)) ? resolve(bin) : undefined;
  }

  const isWindows = platform === "win32";
  const pathEntries = (process.env.PATH ?? "")
    .split(delimiter)
    .filter((p) => p.length > 0);
  if (pathEntries.length === 0) return undefined;

  // On Windows, try the name as-is AND each PATHEXT suffix.
  const exts = isWindows ? parsePathExt() : [""];
  // If the user already provided an extension, try that exact name first.
  const hasExplicitExt = /\.[A-Za-z0-9]+$/.test(bin);

  for (const dir of pathEntries) {
    if (isWindows) {
      if (hasExplicitExt) {
        const candidate = join(dir, bin);
        if (await isExecutableFile(candidate)) return candidate;
      }
      for (const ext of exts) {
        const candidate = join(dir, bin + ext);
        if (await isExecutableFile(candidate)) return candidate;
      }
    } else {
      const candidate = join(dir, bin);
      if (await isExecutableFile(candidate)) return candidate;
    }
  }
  return undefined;
}

function parsePathExt(): string[] {
  // Default PATHEXT on modern Windows.
  const raw =
    process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD;.VBS;.JS;.WS;.MSC;.PS1";
  return raw
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

async function isExecutableFile(p: string): Promise<boolean> {
  try {
    const s = await stat(p);
    if (!s.isFile()) return false;
  } catch {
    return false;
  }
  if (platform === "win32") {
    // Windows has no "executable bit"; presence + extension match is enough.
    return true;
  }
  try {
    await access(p, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** True when the current process is running on Windows. */
export function isWindows(): boolean {
  return platform === "win32";
}
