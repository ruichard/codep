import { CliSpawnRunner, type CliSpawnConfig } from "./cli-spawn.js";
import type { ProviderId, Runner } from "./base.js";

const claudeCfg: CliSpawnConfig = {
  id: "claude",
  displayName: "Claude Code",
  bin: "claude",
  // `claude -p "<prompt>"` runs non-interactively and prints to stdout.
  buildArgs: (prompt) => ["-p", prompt],
  authEnvVars: ["ANTHROPIC_API_KEY", "CLAUDE_CODE_OAUTH_TOKEN"],
  authPaths: [".claude/.credentials.json", ".config/claude/credentials.json"],
  versionArgs: ["--version"],
};

const codexCfg: CliSpawnConfig = {
  id: "codex",
  displayName: "OpenAI Codex CLI",
  bin: "codex",
  // `codex exec "<prompt>"` runs non-interactively.
  buildArgs: (prompt) => ["exec", prompt],
  authEnvVars: ["OPENAI_API_KEY"],
  authPaths: [".codex/auth.json", ".config/codex/auth.json"],
  // Authoritative: `codex login status` exits 0 iff logged in and prints
  // `Logged in using ...`; exits non-zero with `Not logged in` otherwise.
  // ~90ms on a warm machine, safe for `codep doctor`.
  authProbeArgs: ["login", "status"],
  versionArgs: ["--version"],
};

const geminiCfg: CliSpawnConfig = {
  id: "gemini",
  displayName: "Gemini CLI",
  bin: "gemini",
  // `gemini -p "<prompt>"` runs non-interactively.
  buildArgs: (prompt) => ["-p", prompt],
  authEnvVars: ["GEMINI_API_KEY", "GOOGLE_API_KEY"],
  // Gemini CLI has rotated auth-file names across versions. Match any of
  // the known ones so the detection doesn't regress when users upgrade.
  authPaths: [
    ".gemini/oauth_creds.json",
    ".gemini/google_accounts.json",
    ".gemini/google_account_id",
    ".config/gcloud/application_default_credentials.json",
  ],
  versionArgs: ["--version"],
};

export const RUNNER_REGISTRY: Record<ProviderId, Runner> = {
  claude: new CliSpawnRunner(claudeCfg),
  codex: new CliSpawnRunner(codexCfg),
  gemini: new CliSpawnRunner(geminiCfg),
};

export function getRunner(id: ProviderId): Runner {
  return RUNNER_REGISTRY[id];
}
