import { access, mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { getGlobalConfigPath } from "../config/load.js";
import { join } from "node:path";

export interface InitArgs {
  scope: "global" | "project";
  force?: boolean;
  cwd?: string;
}

const TEMPLATE = {
  priority: "quality",
  fallbackPolicy: "warn",
  // Uncomment to customize:
  // allowProviders: ["claude", "codex", "gemini"],
  // denyProviders: [],
  // perTaskType: { ui_frontend: "claude", algorithm: "codex" },
  // timeoutSec: 120,
};

async function exists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

export async function initCommand(args: InitArgs): Promise<number> {
  const cwd = args.cwd ?? process.cwd();
  const path =
    args.scope === "global"
      ? getGlobalConfigPath()
      : join(cwd, ".codep.json");

  if ((await exists(path)) && !args.force) {
    process.stderr.write(
      `codep: ${path} already exists. Pass --force to overwrite.\n`,
    );
    return 2;
  }

  try {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify(TEMPLATE, null, 2) + "\n", "utf8");
  } catch (err) {
    process.stderr.write(
      `codep: failed to write ${path}: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    return 1;
  }

  process.stdout.write(`Wrote ${path}\n`);
  process.stdout.write(
    `Run \`codep config show\` to verify, or edit the file to customize.\n`,
  );
  return 0;
}
