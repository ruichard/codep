import type { Capabilities, ProviderId, Runner } from "../runners/base.js";
import { RUNNER_REGISTRY } from "../runners/registry.js";
import type { ClassifyResult } from "./classifier.js";
import { TASK_TYPES, isTaskType, type TaskType } from "./taxonomy.js";

export interface ClassifierHints {
  hasImage?: boolean;
  contextTokens?: number;
}

/**
 * Preference order for the classifier provider when none is configured.
 * Chosen for cost / latency: gemini has the cheapest flash tier, codex next,
 * claude last (most expensive).
 */
const DEFAULT_PROVIDER_ORDER: readonly ProviderId[] = [
  "gemini",
  "codex",
  "claude",
];

export interface PickProviderOpts {
  availability: Record<ProviderId, Capabilities>;
  /** Explicit preference from config; used first if available. */
  preferred?: ProviderId;
}

/** Pick the best available provider to run classification with. */
export function pickClassifierProvider(
  opts: PickProviderOpts,
): ProviderId | undefined {
  const usable = (id: ProviderId): boolean => {
    const c = opts.availability[id];
    return !!c && c.installed && c.authenticated;
  };
  if (opts.preferred && usable(opts.preferred)) return opts.preferred;
  for (const id of DEFAULT_PROVIDER_ORDER) {
    if (usable(id)) return id;
  }
  return undefined;
}

/**
 * Build the classification prompt. Short, deterministic, asks for a single
 * structured line so we can parse it cheaply.
 */
export function buildClassifierPrompt(
  userPrompt: string,
  hints: ClassifierHints = {},
): string {
  const truncated =
    userPrompt.length > 2_000
      ? userPrompt.slice(0, 2_000) + `… [+${userPrompt.length - 2_000} chars]`
      : userPrompt;
  const hintLines: string[] = [];
  if (hints.hasImage) hintLines.push("- The task involves an image attachment.");
  if (hints.contextTokens !== undefined && hints.contextTokens >= 20_000) {
    hintLines.push(
      `- The user is attaching a large context (~${hints.contextTokens} tokens).`,
    );
  }
  const hintsBlock =
    hintLines.length > 0 ? `\nAdditional hints:\n${hintLines.join("\n")}\n` : "";

  return [
    "You are a router. Classify the following coding task into exactly ONE of",
    "these task types. Respond with ONLY two lines in this exact format:",
    "",
    "taskType: <one-of-the-types>",
    "confidence: <number between 0 and 1>",
    "",
    `Valid task types: ${TASK_TYPES.join(", ")}.`,
    "",
    "Do not add any other text, markdown, or explanations.",
    hintsBlock,
    "--- task ---",
    truncated,
    "--- end task ---",
  ].join("\n");
}

/**
 * Parse the classifier's response. Tolerant to surrounding whitespace,
 * extra prose, or case differences. Returns undefined if no valid task
 * type line can be found.
 */
export function parseClassifierResponse(
  raw: string,
): { taskType: TaskType; confidence: number } | undefined {
  const lines = raw.split(/\r?\n/);
  let taskType: TaskType | undefined;
  let confidence: number | undefined;

  for (const line of lines) {
    const tMatch = /^\s*taskType\s*[:=]\s*([a-z_]+)\s*$/i.exec(line);
    if (tMatch) {
      const candidate = tMatch[1]!.toLowerCase();
      if (isTaskType(candidate)) {
        taskType = candidate;
        continue;
      }
    }
    const cMatch = /^\s*confidence\s*[:=]\s*([0-9]*\.?[0-9]+)\s*$/i.exec(line);
    if (cMatch) {
      const n = Number(cMatch[1]);
      if (Number.isFinite(n) && n >= 0 && n <= 1) confidence = n;
    }
  }

  // Fallback: scan the whole response for any known task type token.
  if (!taskType) {
    for (const t of TASK_TYPES) {
      const re = new RegExp(`\\b${t}\\b`, "i");
      if (re.test(raw)) {
        taskType = t;
        break;
      }
    }
  }

  if (!taskType) return undefined;
  return { taskType, confidence: confidence ?? 0.7 };
}

export interface ClassifyWithLlmOpts {
  runner: Runner;
  userPrompt: string;
  hints?: ClassifierHints;
  timeoutMs?: number;
  /** Max chars to keep from stdout before parsing (safety cap). */
  maxResponseBytes?: number;
  /** Override the prompt builder (tests). */
  buildPrompt?: typeof buildClassifierPrompt;
}

/**
 * Invoke a runner to classify a prompt. Returns a ClassifyResult on success
 * or throws on failure; callers should catch and fall back to the heuristic.
 */
export async function classifyWithLlm(
  opts: ClassifyWithLlmOpts,
): Promise<ClassifyResult> {
  const build = opts.buildPrompt ?? buildClassifierPrompt;
  const prompt = build(opts.userPrompt, opts.hints);
  const timeoutMs = opts.timeoutMs ?? 10_000;
  const maxBytes = opts.maxResponseBytes ?? 4_000;

  const controller = new AbortController();
  const chunks: string[] = [];
  let size = 0;
  let exitCode = 0;
  let timedOut = false;

  for await (const chunk of opts.runner.run(prompt, {
    signal: controller.signal,
    timeoutMs,
  })) {
    if (chunk.type === "stdout") {
      chunks.push(chunk.data);
      size += chunk.data.length;
      if (size > maxBytes) controller.abort();
    } else if (chunk.type === "exit") {
      exitCode = chunk.code;
      timedOut = !!chunk.timedOut;
    }
  }

  if (timedOut) {
    throw new Error(`llm classifier timed out after ${timeoutMs}ms`);
  }
  if (exitCode !== 0) {
    throw new Error(`llm classifier exited with code ${exitCode}`);
  }

  const raw = chunks.join("");
  const parsed = parseClassifierResponse(raw);
  if (!parsed) {
    throw new Error(
      `llm classifier: could not parse response (${raw.slice(0, 80)}…)`,
    );
  }
  return {
    taskType: parsed.taskType,
    confidence: Number(parsed.confidence.toFixed(2)),
    reason: `llm(${opts.runner.id}) → ${parsed.taskType}`,
    source: "llm",
  };
}

/** Convenience: look up a runner from the built-in registry. */
export function runnerForProvider(id: ProviderId): Runner {
  return RUNNER_REGISTRY[id];
}

/** For tests: return the built-in provider id order used by default. */
export function defaultClassifierProviderOrder(): readonly ProviderId[] {
  return DEFAULT_PROVIDER_ORDER;
}
