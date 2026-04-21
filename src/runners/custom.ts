import { CliSpawnRunner, type CliSpawnConfig } from "./cli-spawn.js";
import type { Runner } from "./base.js";
import { ALL_PROVIDERS } from "./base.js";

/**
 * Shape of a custom provider entry in `.codep.json`. Users can declare
 * additional CLI-based coding agents (cursor-agent, aider, opencode, ...)
 * without modifying codep's source. Custom providers are invocable via
 * `--model <id>` only — they do not participate in auto-routing.
 */
export interface CustomProviderConfig {
  displayName?: string;
  /** Executable name looked up on PATH. */
  bin: string;
  /**
   * Argv template for non-interactive invocation. Any occurrence of the
   * literal string `{prompt}` is substituted with the assembled prompt.
   * If no placeholder is found, the prompt is appended as the last arg.
   */
  args: readonly string[];
  /** Env vars that, if set, are considered proof of authentication. */
  authEnvVars?: readonly string[];
  /** Files under $HOME whose existence implies interactive login. */
  authPaths?: readonly string[];
  versionArgs?: readonly string[];
}

const PROMPT_PLACEHOLDER = "{prompt}";

function buildArgs(template: readonly string[], prompt: string): string[] {
  const hasPlaceholder = template.some((a) => a.includes(PROMPT_PLACEHOLDER));
  if (hasPlaceholder) {
    return template.map((a) => a.split(PROMPT_PLACEHOLDER).join(prompt));
  }
  return [...template, prompt];
}

function validateEntry(id: string, v: unknown, source: string): CustomProviderConfig {
  if (typeof v !== "object" || v === null || Array.isArray(v)) {
    throw new Error(
      `${source}: providers.${id} must be an object with \`bin\` and \`args\``,
    );
  }
  const r = v as Record<string, unknown>;
  if (typeof r.bin !== "string" || r.bin.length === 0) {
    throw new Error(`${source}: providers.${id}.bin must be a non-empty string`);
  }
  if (
    !Array.isArray(r.args) ||
    !r.args.every((a) => typeof a === "string")
  ) {
    throw new Error(
      `${source}: providers.${id}.args must be an array of strings`,
    );
  }
  const out: CustomProviderConfig = {
    bin: r.bin,
    args: r.args as string[],
  };
  if (typeof r.displayName === "string") out.displayName = r.displayName;
  for (const key of ["authEnvVars", "authPaths", "versionArgs"] as const) {
    if (r[key] !== undefined) {
      if (
        !Array.isArray(r[key]) ||
        !(r[key] as unknown[]).every((x) => typeof x === "string")
      ) {
        throw new Error(
          `${source}: providers.${id}.${key} must be an array of strings`,
        );
      }
      out[key] = r[key] as string[];
    }
  }
  return out;
}

/**
 * Validate the `providers` section of a loaded config. Throws on bad shape
 * or id collision with a built-in provider.
 */
export function validateCustomProviders(
  raw: unknown,
  source: string,
): Record<string, CustomProviderConfig> {
  if (raw === undefined) return {};
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error(`${source}: "providers" must be an object`);
  }
  const out: Record<string, CustomProviderConfig> = {};
  for (const [id, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!/^[a-z][a-z0-9-]*$/i.test(id)) {
      throw new Error(
        `${source}: custom provider id "${id}" must match /^[a-z][a-z0-9-]*$/i`,
      );
    }
    if ((ALL_PROVIDERS as readonly string[]).includes(id)) {
      throw new Error(
        `${source}: custom provider id "${id}" collides with built-in provider`,
      );
    }
    out[id] = validateEntry(id, v, source);
  }
  return out;
}

export function buildCustomRunner(
  id: string,
  cfg: CustomProviderConfig,
): Runner {
  const spawn: CliSpawnConfig = {
    id,
    displayName: cfg.displayName ?? id,
    bin: cfg.bin,
    buildArgs: (prompt) => buildArgs(cfg.args, prompt),
    authEnvVars: cfg.authEnvVars ?? [],
    authPaths: cfg.authPaths ?? [],
    versionArgs: cfg.versionArgs,
  };
  return new CliSpawnRunner(spawn);
}

export function buildCustomRunners(
  providers: Record<string, CustomProviderConfig>,
): Record<string, Runner> {
  const out: Record<string, Runner> = {};
  for (const [id, cfg] of Object.entries(providers)) {
    out[id] = buildCustomRunner(id, cfg);
  }
  return out;
}
