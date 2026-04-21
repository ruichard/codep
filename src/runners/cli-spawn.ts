import { execa } from "execa";
import { access, constants } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type {
  Capabilities,
  Runner,
  RunnerChunk,
  RunOptions,
} from "./base.js";
import { isWindows, whichBin } from "./which.js";

/**
 * Configuration describing how to spawn one provider's official CLI in
 * non-interactive mode. Kept as plain data so new providers are easy to add.
 */
export interface CliSpawnConfig {
  id: string;
  displayName: string;
  /** Executable name looked up on PATH. */
  bin: string;
  /**
   * Build argv from the user prompt. For all three Phase-1 CLIs this is a
   * simple positional-or-flag wrapper.
   */
  buildArgs(prompt: string): string[];
  /** Environment variables that, if set, are considered proof of auth. */
  authEnvVars: readonly string[];
  /** Files under $HOME whose existence implies interactive login. */
  authPaths: readonly string[];
  /**
   * Optional authoritative auth probe — argv run against the binary itself.
   * Exit code 0 ⇒ authenticated, anything else ⇒ not. Only invoked when the
   * caller requests a live probe (`opts.probe === true`) and overrides env /
   * path heuristics when it gives a definitive answer. Kept optional because
   * not every provider CLI ships a status subcommand.
   */
  authProbeArgs?: readonly string[];
  /** Argv for a cheap `--version` probe used during live health checks. */
  versionArgs?: readonly string[];
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await access(p, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function resolveBin(bin: string): Promise<string | undefined> {
  return whichBin(bin);
}

/**
 * Windows needs `shell: true` to invoke `.cmd` / `.bat` / `.ps1` shims
 * that npm generates for global installs (e.g. `claude.cmd`, `codex.cmd`).
 * On Unix this is a no-op.
 */
function needsShell(binPath: string | undefined): boolean {
  if (!isWindows() || !binPath) return false;
  return /\.(cmd|bat|ps1)$/i.test(binPath);
}

/**
 * Generic Runner that drives a provider's official CLI via `execa`.
 * The only provider-specific data lives in `CliSpawnConfig`.
 */
export class CliSpawnRunner implements Runner {
  constructor(private readonly cfg: CliSpawnConfig) {}

  get id(): string {
    return this.cfg.id;
  }

  get displayName(): string {
    return this.cfg.displayName;
  }

  async capabilities(opts?: { probe?: boolean }): Promise<Capabilities> {
    const binPath = await resolveBin(this.cfg.bin);
    const installed = binPath !== undefined;
    if (!installed) {
      return {
        installed: false,
        authenticated: false,
        detail: `\`${this.cfg.bin}\` not found on PATH`,
      };
    }

    const home = homedir();
    const envHit = this.cfg.authEnvVars.some((k) => !!process.env[k]);
    let pathHit = false;
    for (const rel of this.cfg.authPaths) {
      if (await pathExists(join(home, rel))) {
        pathHit = true;
        break;
      }
    }
    let authenticated = envHit || pathHit;
    let authProbeDetail: string | undefined;

    // Live auth probe (e.g. `codex login status`). Run only when the caller
    // asked for a probe — `codep doctor` does, per-run routing does not —
    // because it spawns a subprocess. Exit 0 is authoritative "yes"; any
    // other exit is authoritative "no" and overrides the file-existence
    // heuristic (files can linger after logout / be created by older CLI
    // versions that no longer represent valid credentials).
    if (opts?.probe && this.cfg.authProbeArgs) {
      try {
        await execa(binPath, [...this.cfg.authProbeArgs], {
          timeout: 5_000,
          shell: needsShell(binPath),
          stdin: "ignore",
        });
        authenticated = true;
      } catch (err) {
        authenticated = false;
        authProbeDetail =
          err instanceof Error && "stderr" in err
            ? String((err as { stderr?: unknown }).stderr ?? "").trim() ||
              err.message
            : "auth probe failed";
      }
    }

    let version: string | undefined;
    let healthy: boolean | undefined;
    if (opts?.probe && this.cfg.versionArgs) {
      try {
        const { stdout } = await execa(
          binPath,
          [...this.cfg.versionArgs],
          {
            timeout: 5_000,
            shell: needsShell(binPath),
          },
        );
        version = stdout.trim().split("\n")[0];
        healthy = true;
      } catch {
        healthy = false;
      }
    }

    return {
      installed,
      authenticated,
      healthy,
      binPath,
      version,
      detail: authenticated
        ? undefined
        : authProbeDetail ?? "no auth env var set and no login file found",
    };
  }

  async *run(
    prompt: string,
    opts: RunOptions = {},
  ): AsyncIterable<RunnerChunk> {
    const argv = [
      ...this.cfg.buildArgs(prompt),
      ...(opts.extraArgs ?? []),
    ];
    // Resolve the binary once so Windows `.cmd`/`.bat` shims spawn correctly
    // and so users see consistent behavior whether or not PATH changes
    // mid-run. Fall back to the configured name if resolution fails — execa
    // will surface a clearer error than we can.
    const binPath = (await whichBin(this.cfg.bin)) ?? this.cfg.bin;
    const child = execa(binPath, argv, {
      cwd: opts.cwd,
      env: { ...process.env, ...opts.env },
      reject: false,
      buffer: false,
      timeout: opts.timeoutMs,
      cancelSignal: opts.signal,
      shell: needsShell(binPath),
      // Close child's stdin immediately. Some CLIs (notably `codex`) see a
      // non-TTY piped stdin and block on "Reading additional input from
      // stdin..." waiting for more context. We already pass the prompt via
      // argv, so there is nothing to pipe in.
      stdin: "ignore",
    });

    // Collect stdout/stderr chunks into a shared queue so we can yield them
    // in arrival order from a single async generator.
    const queue: RunnerChunk[] = [];
    let resolveNext: (() => void) | null = null;
    const notify = () => {
      if (resolveNext) {
        const r = resolveNext;
        resolveNext = null;
        r();
      }
    };

    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (d: string) => {
      queue.push({ type: "stdout", data: d });
      notify();
    });
    child.stderr?.on("data", (d: string) => {
      queue.push({ type: "stderr", data: d });
      notify();
    });

    const done = child.then(
      (res) => {
        queue.push({
          type: "exit",
          code: res.exitCode ?? 0,
          signal: (res.signal as NodeJS.Signals | undefined) ?? null,
        });
        notify();
      },
      (err: unknown) => {
        const code =
          typeof err === "object" && err !== null && "exitCode" in err
            ? (err as { exitCode?: number }).exitCode ?? 1
            : 1;
        const timedOut =
          typeof err === "object" && err !== null && "timedOut" in err
            ? !!(err as { timedOut?: boolean }).timedOut
            : false;
        queue.push({ type: "exit", code, timedOut });
        notify();
      },
    );

    while (true) {
      if (queue.length === 0) {
        await new Promise<void>((resolve) => {
          resolveNext = resolve;
        });
      }
      const chunk = queue.shift()!;
      yield chunk;
      if (chunk.type === "exit") {
        await done;
        return;
      }
    }
  }
}
