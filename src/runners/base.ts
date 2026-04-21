/**
 * Provider identifier. Phase 1 spans the three closed-source flagship CLIs.
 */
export type ProviderId = "claude" | "codex" | "gemini";

export const ALL_PROVIDERS: readonly ProviderId[] = [
  "claude",
  "codex",
  "gemini",
] as const;

/**
 * Availability of a provider CLI on the user's machine.
 * Each dimension is independent: a CLI may be installed without being
 * authenticated, and authenticated without being healthy.
 */
export interface Capabilities {
  installed: boolean;
  authenticated: boolean;
  /**
   * Optional live probe. `undefined` when not measured (default for non-doctor flows).
   */
  healthy?: boolean;
  /** Resolved absolute path of the CLI binary, when installed. */
  binPath?: string;
  /** Detected version string, when cheaply available. */
  version?: string;
  /** Free-text detail for display (e.g. "not logged in", "binary not on PATH"). */
  detail?: string;
}

/**
 * A chunk of streaming output from a runner. Phase 1 only needs raw stdio.
 */
export type RunnerChunk =
  | { type: "stdout"; data: string }
  | { type: "stderr"; data: string }
  | {
      type: "exit";
      code: number;
      signal?: NodeJS.Signals | null;
      timedOut?: boolean;
    };

export interface RunOptions {
  /** Working directory to spawn the child CLI in. */
  cwd?: string;
  /** Abort signal for Ctrl+C / timeout. */
  signal?: AbortSignal;
  /** Extra env vars to layer on top of `process.env`. */
  env?: Record<string, string>;
  /** Hard timeout in ms. */
  timeoutMs?: number;
  /** Extra argv forwarded to the vendor CLI (after provider-specific args). */
  extraArgs?: readonly string[];
}

/**
 * A Runner encapsulates "how to talk to one provider's official CLI in
 * non-interactive mode". Phase 2 will add `ApiRunner` implementations that
 * honor the same contract so the router stays provider-agnostic.
 */
export interface Runner {
  readonly id: string;
  /** Display name, e.g. "Claude Code". */
  readonly displayName: string;
  /**
   * Probe the local environment. Cheap by default; passing `probe: true`
   * may perform a live health check.
   */
  capabilities(opts?: { probe?: boolean }): Promise<Capabilities>;
  /**
   * Execute a prompt non-interactively and stream back chunks.
   * Implementations MUST yield a final `{ type: "exit" }` chunk.
   */
  run(prompt: string, opts?: RunOptions): AsyncIterable<RunnerChunk>;
}
