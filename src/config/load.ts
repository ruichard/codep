import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { ProviderId } from "../runners/base.js";
import { ALL_PROVIDERS } from "../runners/base.js";
import {
  validateCustomProviders,
  type CustomProviderConfig,
} from "../runners/custom.js";
import type { FallbackPolicy } from "../router/pipeline.js";
import type { Priority } from "../router/profiles.js";
import { isTaskType, type TaskType } from "../router/taxonomy.js";

/**
 * User-facing configuration. All fields are optional; flags on the CLI
 * override config values, and project config overrides global config.
 */
export interface CodepConfig {
  priority?: Priority;
  fallbackPolicy?: FallbackPolicy;
  /** Subset of providers allowed for routing; others are excluded entirely. */
  allowProviders?: readonly ProviderId[];
  /** Providers never picked by the router. Forced --model still wins. */
  denyProviders?: readonly ProviderId[];
  /** Force a specific provider per task type. */
  perTaskType?: Partial<Record<TaskType, ProviderId>>;
  /** Default --timeout in seconds. */
  timeoutSec?: number;
  /** User-defined custom CLI providers (invocable via --model only). */
  providers?: Record<string, CustomProviderConfig>;
  /**
   * Classifier mode.
   *  - "heuristic" (default): keyword rules only.
   *  - "llm": always ask an LLM, falling back to heuristic on failure.
   *  - "auto": use heuristic, but call an LLM when heuristic confidence is
   *    below `classifierConfidenceThreshold`.
   */
  classifier?: "heuristic" | "llm" | "auto";
  /** Preferred provider for LLM-assisted classification. */
  classifierProvider?: ProviderId;
  /** Threshold under which "auto" mode escalates to the LLM. Default 0.4. */
  classifierConfidenceThreshold?: number;
  /** Hard wall-clock timeout for the classifier call in ms. Default 10000. */
  classifierTimeoutMs?: number;
}

export interface LoadedConfig {
  config: CodepConfig;
  /** Absolute paths of the config files that were merged, in apply order
   *  (global first, project last). */
  sources: string[];
}

const GLOBAL_PATH = () => join(homedir(), ".codep", "config.json");
const PROJECT_FILES = [".codep.json", ".codep/config.json"];

async function readJsonIfExists(path: string): Promise<unknown | undefined> {
  try {
    const raw = await readFile(path, "utf8");
    return JSON.parse(raw);
  } catch (err) {
    if (
      typeof err === "object" &&
      err !== null &&
      "code" in err &&
      (err as { code?: string }).code === "ENOENT"
    ) {
      return undefined;
    }
    throw err;
  }
}

function isProviderId(v: unknown): v is ProviderId {
  return typeof v === "string" && (ALL_PROVIDERS as readonly string[]).includes(v);
}

function validate(raw: unknown, source: string): CodepConfig {
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`${source}: config must be a JSON object`);
  }
  const r = raw as Record<string, unknown>;
  const out: CodepConfig = {};

  if (r.priority !== undefined) {
    if (
      r.priority !== "quality" &&
      r.priority !== "balanced" &&
      r.priority !== "cheap"
    ) {
      throw new Error(
        `${source}: "priority" must be one of quality|balanced|cheap`,
      );
    }
    out.priority = r.priority;
  }
  if (r.fallbackPolicy !== undefined) {
    if (
      r.fallbackPolicy !== "auto" &&
      r.fallbackPolicy !== "warn" &&
      r.fallbackPolicy !== "fail"
    ) {
      throw new Error(
        `${source}: "fallbackPolicy" must be one of auto|warn|fail`,
      );
    }
    out.fallbackPolicy = r.fallbackPolicy;
  }
  if (r.allowProviders !== undefined) {
    if (!Array.isArray(r.allowProviders) || !r.allowProviders.every(isProviderId)) {
      throw new Error(
        `${source}: "allowProviders" must be an array of provider ids`,
      );
    }
    out.allowProviders = r.allowProviders;
  }
  if (r.denyProviders !== undefined) {
    if (!Array.isArray(r.denyProviders) || !r.denyProviders.every(isProviderId)) {
      throw new Error(
        `${source}: "denyProviders" must be an array of provider ids`,
      );
    }
    out.denyProviders = r.denyProviders;
  }
  if (r.perTaskType !== undefined) {
    if (
      typeof r.perTaskType !== "object" ||
      r.perTaskType === null ||
      Array.isArray(r.perTaskType)
    ) {
      throw new Error(`${source}: "perTaskType" must be an object`);
    }
    const map: Partial<Record<TaskType, ProviderId>> = {};
    for (const [k, v] of Object.entries(
      r.perTaskType as Record<string, unknown>,
    )) {
      if (!isTaskType(k)) {
        throw new Error(`${source}: perTaskType: unknown task type "${k}"`);
      }
      if (!isProviderId(v)) {
        throw new Error(
          `${source}: perTaskType.${k}: unknown provider "${String(v)}"`,
        );
      }
      map[k] = v;
    }
    out.perTaskType = map;
  }
  if (r.timeoutSec !== undefined) {
    if (typeof r.timeoutSec !== "number" || !Number.isFinite(r.timeoutSec) || r.timeoutSec <= 0) {
      throw new Error(`${source}: "timeoutSec" must be a positive number`);
    }
    out.timeoutSec = r.timeoutSec;
  }
  if (r.providers !== undefined) {
    out.providers = validateCustomProviders(r.providers, source);
  }
  if (r.classifier !== undefined) {
    if (
      r.classifier !== "heuristic" &&
      r.classifier !== "llm" &&
      r.classifier !== "auto"
    ) {
      throw new Error(
        `${source}: "classifier" must be one of heuristic|llm|auto`,
      );
    }
    out.classifier = r.classifier;
  }
  if (r.classifierProvider !== undefined) {
    if (!isProviderId(r.classifierProvider)) {
      throw new Error(
        `${source}: "classifierProvider" must be one of ${ALL_PROVIDERS.join("|")}`,
      );
    }
    out.classifierProvider = r.classifierProvider;
  }
  if (r.classifierConfidenceThreshold !== undefined) {
    if (
      typeof r.classifierConfidenceThreshold !== "number" ||
      !Number.isFinite(r.classifierConfidenceThreshold) ||
      r.classifierConfidenceThreshold < 0 ||
      r.classifierConfidenceThreshold > 1
    ) {
      throw new Error(
        `${source}: "classifierConfidenceThreshold" must be a number in [0,1]`,
      );
    }
    out.classifierConfidenceThreshold = r.classifierConfidenceThreshold;
  }
  if (r.classifierTimeoutMs !== undefined) {
    if (
      typeof r.classifierTimeoutMs !== "number" ||
      !Number.isFinite(r.classifierTimeoutMs) ||
      r.classifierTimeoutMs <= 0
    ) {
      throw new Error(
        `${source}: "classifierTimeoutMs" must be a positive number`,
      );
    }
    out.classifierTimeoutMs = r.classifierTimeoutMs;
  }
  return out;
}

/**
 * Walk upward from `startDir` looking for any of the project config names.
 * Returns the first match (closest to the starting dir) or undefined.
 */
async function findProjectConfig(startDir: string): Promise<string | undefined> {
  let dir = resolve(startDir);
  for (;;) {
    for (const name of PROJECT_FILES) {
      const candidate = join(dir, name);
      try {
        await readFile(candidate, "utf8");
        return candidate;
      } catch {
        // keep looking
      }
    }
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

function merge(base: CodepConfig, override: CodepConfig): CodepConfig {
  return {
    priority: override.priority ?? base.priority,
    fallbackPolicy: override.fallbackPolicy ?? base.fallbackPolicy,
    allowProviders: override.allowProviders ?? base.allowProviders,
    denyProviders: override.denyProviders ?? base.denyProviders,
    perTaskType: { ...(base.perTaskType ?? {}), ...(override.perTaskType ?? {}) },
    timeoutSec: override.timeoutSec ?? base.timeoutSec,
    providers: { ...(base.providers ?? {}), ...(override.providers ?? {}) },
    classifier: override.classifier ?? base.classifier,
    classifierProvider: override.classifierProvider ?? base.classifierProvider,
    classifierConfidenceThreshold:
      override.classifierConfidenceThreshold ??
      base.classifierConfidenceThreshold,
    classifierTimeoutMs:
      override.classifierTimeoutMs ?? base.classifierTimeoutMs,
  };
}

export interface LoadOptions {
  /** Override the CWD used to locate a project config (for tests). */
  cwd?: string;
  /** Override the global config path (for tests). */
  globalPath?: string;
}

export async function loadConfig(opts: LoadOptions = {}): Promise<LoadedConfig> {
  const sources: string[] = [];
  const globalPath = opts.globalPath ?? GLOBAL_PATH();
  let merged: CodepConfig = {};

  const globalRaw = await readJsonIfExists(globalPath);
  if (globalRaw !== undefined) {
    merged = merge(merged, validate(globalRaw, globalPath));
    sources.push(globalPath);
  }

  const projectPath = await findProjectConfig(opts.cwd ?? process.cwd());
  if (projectPath) {
    const projectRaw = await readJsonIfExists(projectPath);
    if (projectRaw !== undefined) {
      merged = merge(merged, validate(projectRaw, projectPath));
      sources.push(projectPath);
    }
  }

  return { config: merged, sources };
}

export function getGlobalConfigPath(): string {
  return GLOBAL_PATH();
}
