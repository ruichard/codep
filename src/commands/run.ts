import { detectAll, invalidate } from "../router/availability.js";
import type { ProviderId, Runner } from "../runners/base.js";
import { ALL_PROVIDERS } from "../runners/base.js";
import { RUNNER_REGISTRY } from "../runners/registry.js";
import { INSTALL_GUIDES } from "../runners/install-guides.js";
import { route, type FallbackPolicy } from "../router/pipeline.js";
import { classify, type ClassifyResult } from "../router/classifier.js";
import {
  classifyWithLlm,
  pickClassifierProvider,
} from "../router/llm-classifier.js";
import type { HardConstraints } from "../router/constraints.js";
import type { Priority } from "../router/profiles.js";
import type { TaskType } from "../router/taxonomy.js";
import { appendRunLog, hashPrompt, type RunLogEntry } from "../log/run-log.js";
import { newSessionId, writeSession } from "../session/store.js";
import { CODEP_VERSION } from "../version.js";

export interface RunArgs {
  prompt: string;
  /** Built-in ProviderId, or a custom provider id from config.providers. */
  model?: string;
  taskType?: TaskType;
  priority: Priority;
  cwd?: string;
  timeoutSec?: number;
  contextTokens?: number;
  contextSources?: readonly string[];
  hasImage?: boolean;
  fallbackPolicy: FallbackPolicy;
  explain?: boolean;
  dryRun?: boolean;
  allowProviders?: readonly ProviderId[];
  denyProviders?: readonly ProviderId[];
  perTaskType?: Partial<Record<TaskType, ProviderId>>;
  /** Extra argv forwarded to the vendor CLI after any `--` on the codep CLI. */
  passthroughArgs?: readonly string[];
  /** If true, never auto-retry on non-zero exit. */
  noRetry?: boolean;
  /** If true, capture the vendor CLI's stdout into a session file under ~/.codep/sessions/. */
  saveSession?: boolean;
  /** User-defined custom runners, keyed by their config id. */
  customRunners?: Record<string, Runner>;
  /** Classifier mode (from config). Defaults to "heuristic". */
  classifier?: "heuristic" | "llm" | "auto";
  classifierProvider?: ProviderId;
  classifierConfidenceThreshold?: number;
  classifierTimeoutMs?: number;
}

function isBuiltInProvider(id: string): id is ProviderId {
  return (ALL_PROVIDERS as readonly string[]).includes(id);
}

function printZeroProviderHelp(): void {
  const lines: string[] = [
    "codep: no provider CLI is configured yet.",
    "",
    "To get started, install AND log in to at least one of:",
    "",
  ];
  for (const id of ALL_PROVIDERS) {
    const g = INSTALL_GUIDES[id];
    lines.push(`  • ${RUNNER_REGISTRY[id].displayName}`);
    lines.push(`      install: ${g.install}`);
    lines.push(`      login:   ${g.login}`);
    lines.push(`      docs:    ${g.docs}`);
    lines.push("");
  }
  lines.push("Then re-run `codep doctor` to verify.");
  process.stderr.write(lines.join("\n") + "\n");
}

function printHeader(
  args: RunArgs,
  provider: ProviderId,
  reason: string,
): void {
  const parts = [
    `[codep] provider=${provider}`,
    `type=${args.taskType ?? "general_chat"}`,
    `priority=${args.priority}`,
    reason,
  ];
  process.stderr.write(parts.join(" · ") + "\n");
}

export async function runCommand(args: RunArgs): Promise<number> {
  // Custom provider short-circuit: when --model names a user-defined runner
  // from config.providers, bypass routing entirely.
  if (args.model && !isBuiltInProvider(args.model)) {
    const custom = args.customRunners?.[args.model];
    if (!custom) {
      process.stderr.write(
        `codep: unknown provider "${args.model}".\n`,
      );
      return 2;
    }
    return runCustom(custom, args);
  }

  const availability = await detectAll();

  const constraints: HardConstraints = {
    contextTokens: args.contextTokens,
    needsVision: args.hasImage,
  };

  // Classify when caller didn't force --type and didn't force --model.
  // (Forced provider short-circuits routing, so classification is moot.)
  let classification: ClassifyResult | undefined;
  let effectiveTaskType = args.taskType;
  if (!args.model && !args.taskType) {
    const heuristic = classify({
      prompt: args.prompt,
      hasImage: args.hasImage,
      contextTokens: args.contextTokens,
    });
    classification = heuristic;

    const mode = args.classifier ?? "heuristic";
    const threshold = args.classifierConfidenceThreshold ?? 0.4;
    const wantLlm =
      mode === "llm" || (mode === "auto" && heuristic.confidence < threshold);

    if (wantLlm) {
      const picked = pickClassifierProvider({
        availability,
        preferred: args.classifierProvider,
      });
      if (picked) {
        try {
          const llmResult = await classifyWithLlm({
            runner: RUNNER_REGISTRY[picked],
            userPrompt: args.prompt,
            hints: {
              hasImage: args.hasImage,
              contextTokens: args.contextTokens,
            },
            timeoutMs: args.classifierTimeoutMs ?? 10_000,
          });
          classification = llmResult;
        } catch (err) {
          process.stderr.write(
            `[codep] warn: llm classifier failed (${err instanceof Error ? err.message : String(err)}); using heuristic "${heuristic.taskType}"\n`,
          );
        }
      } else if (mode === "llm") {
        process.stderr.write(
          `[codep] warn: classifier=llm but no provider available; using heuristic\n`,
        );
      }
    }

    effectiveTaskType = classification.taskType;
  } else if (args.taskType) {
    classification = {
      taskType: args.taskType,
      confidence: 1,
      reason: "forced via --type",
      source: "forced",
    };
  }

  const decision = route({
    prompt: args.prompt,
    forcedProvider: args.model as ProviderId | undefined,
    taskType: effectiveTaskType,
    priority: args.priority,
    constraints,
    availability,
    fallbackPolicy: args.fallbackPolicy,
    allowProviders: args.allowProviders,
    denyProviders: args.denyProviders,
    perTaskType: args.perTaskType,
  });

  switch (decision.kind) {
    case "no_providers":
      printZeroProviderHelp();
      return 2;
    case "forced_unavailable": {
      const usableList = ALL_PROVIDERS.filter(
        (id) => availability[id].installed && availability[id].authenticated,
      );
      process.stderr.write(
        `codep: --model ${decision.provider} is ${decision.reason}.\n` +
          `Available: ${usableList.join(", ") || "(none)"}\n`,
      );
      return 2;
    }
    case "constraints_empty":
      process.stderr.write(
        "codep: no provider satisfies the hard constraints:\n" +
          decision.rejected
            .map((r) => `  - ${r.provider}: ${r.reason}`)
            .join("\n") +
          "\n",
      );
      return 2;
    case "ideal_unavailable_fail":
      process.stderr.write(`codep: ${decision.reason}.\n`);
      return 2;
    case "ok":
      break;
  }

  if (args.explain) {
    process.stdout.write("Routing decision:\n");
    process.stdout.write(`  provider:  ${decision.provider}\n`);
    process.stdout.write(`  task_type: ${decision.taskType}\n`);
    if (classification) {
      process.stdout.write(
        `  classifier: ${classification.source} (confidence=${classification.confidence.toFixed(2)}) — ${classification.reason}\n`,
      );
    }
    process.stdout.write(`  priority:  ${decision.priority}\n`);
    if (args.contextSources && args.contextSources.length > 0) {
      process.stdout.write(
        `  input:     ${args.contextSources.join(", ")} (~${args.contextTokens ?? 0} tokens)\n`,
      );
    }
    process.stdout.write(`  reason:    ${decision.reason}\n`);
    if (decision.idealProvider) {
      process.stdout.write(
        `  ideal:     ${decision.idealProvider} (unavailable)\n`,
      );
    }
    if (decision.scores.length > 0) {
      process.stdout.write("  scores:\n");
      for (const s of decision.scores) {
        process.stdout.write(
          `    - ${s.provider.padEnd(7)} score=${s.score.toFixed(1)}  ` +
            `quality=${s.quality.toFixed(2)}  cost_penalty=${s.costPenalty.toFixed(2)}\n`,
        );
      }
    }
    if (args.passthroughArgs && args.passthroughArgs.length > 0) {
      process.stdout.write(
        `  passthrough: ${args.passthroughArgs.join(" ")}\n`,
      );
    }
    return 0;
  }

  const runner = RUNNER_REGISTRY[decision.provider];

  if (args.dryRun) {
    const extra =
      args.passthroughArgs && args.passthroughArgs.length > 0
        ? ` -- ${args.passthroughArgs.join(" ")}`
        : "";
    process.stdout.write(
      `[codep] dry-run · provider=${decision.provider} · ${runner.displayName}${extra}\n` +
        `[codep] prompt: ${JSON.stringify(args.prompt)}\n`,
    );
    return 0;
  }

  if (decision.degraded) {
    process.stderr.write(
      `[codep] note: ideal provider \`${decision.idealProvider}\` is unavailable, ` +
        `falling back to \`${decision.provider}\`.\n`,
    );
  }

  const canRetry =
    !args.noRetry && !args.model && args.fallbackPolicy !== "fail";
  const MAX_ATTEMPTS = 3;

  let attempt = 0;
  let currentProvider: ProviderId = decision.provider;
  let currentReason = decision.reason;
  let previousProvider: ProviderId | undefined;
  const triedDeny = new Set<ProviderId>(args.denyProviders ?? []);
  let lastExitCode = 0;

  while (true) {
    attempt += 1;
    printHeader(args, currentProvider, currentReason);

    const attemptStart = Date.now();
    const capture: string[] = [];
    const { exitCode, timedOut, aborted } = await executeRunner(
      RUNNER_REGISTRY[currentProvider],
      args,
      args.saveSession ? capture : undefined,
    );
    lastExitCode = exitCode;

    if (timedOut) {
      process.stderr.write(
        `[codep] error: provider \`${currentProvider}\` timed out after ${args.timeoutSec}s.\n`,
      );
    }

    await writeRunLog({
      args,
      decision: { ...decision, provider: currentProvider, reason: currentReason },
      classification,
      effectiveTaskType,
      exitCode,
      timedOut,
      startedAt: attemptStart,
      attempt,
      previousProvider,
    });

    if (args.saveSession) {
      const id = newSessionId();
      try {
        const path = await writeSession({
          id,
          ts: new Date(attemptStart).toISOString(),
          provider: currentProvider,
          taskType: effectiveTaskType ?? decision.taskType,
          priority: args.priority,
          prompt: args.prompt,
          output: capture.join(""),
          exitCode,
          durationMs: Date.now() - attemptStart,
          codepVersion: CODEP_VERSION,
        });
        process.stderr.write(`[codep] session saved: ${id}  (${path})\n`);
      } catch (err) {
        process.stderr.write(
          `[codep] warn: failed to save session: ${err instanceof Error ? err.message : String(err)}\n`,
        );
      }
    }

    const shouldRetry =
      canRetry &&
      exitCode !== 0 &&
      !timedOut &&
      !aborted &&
      attempt < MAX_ATTEMPTS;

    if (!shouldRetry) break;

    triedDeny.add(currentProvider);
    invalidate(currentProvider);

    const retry = route({
      prompt: args.prompt,
      taskType: effectiveTaskType,
      priority: args.priority,
      constraints,
      availability,
      fallbackPolicy: "auto",
      allowProviders: args.allowProviders,
      denyProviders: Array.from(triedDeny),
      perTaskType: args.perTaskType,
    });

    if (retry.kind !== "ok") {
      process.stderr.write(
        `[codep] runtime fallback exhausted: ${currentProvider} exited ${exitCode}, ` +
          `no further candidates.\n`,
      );
      break;
    }

    process.stderr.write(
      `\n[codep] runtime fallback: \`${currentProvider}\` exited ${exitCode}, ` +
        `retrying with \`${retry.provider}\`.\n`,
    );
    previousProvider = currentProvider;
    currentProvider = retry.provider;
    currentReason = `runtime fallback from ${previousProvider}: ${retry.reason}`;
  }

  return lastExitCode;
}

interface ExecuteResult {
  exitCode: number;
  timedOut: boolean;
  aborted: boolean;
}

async function executeRunner(
  runner: Runner,
  args: RunArgs,
  capture?: string[],
): Promise<ExecuteResult> {
  const controller = new AbortController();
  let aborted = false;
  const sigint = () => {
    aborted = true;
    controller.abort();
  };
  process.on("SIGINT", sigint);

  let exitCode = 0;
  let timedOut = false;
  try {
    for await (const chunk of runner.run(args.prompt, {
      cwd: args.cwd ?? process.cwd(),
      signal: controller.signal,
      timeoutMs: args.timeoutSec ? args.timeoutSec * 1000 : undefined,
      extraArgs: args.passthroughArgs,
    })) {
      if (chunk.type === "stdout") {
        process.stdout.write(chunk.data);
        if (capture) capture.push(chunk.data);
      } else if (chunk.type === "stderr") process.stderr.write(chunk.data);
      else if (chunk.type === "exit") {
        exitCode = chunk.code;
        timedOut = !!chunk.timedOut;
      }
    }
  } catch (err) {
    process.stderr.write(
      `codep: runner error: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    if (isBuiltInProvider(runner.id)) invalidate(runner.id);
    exitCode = 1;
  } finally {
    process.off("SIGINT", sigint);
  }

  return { exitCode, timedOut, aborted };
}

/**
 * Run a custom (user-defined) provider. Bypasses routing, classification,
 * and runtime fallback — the user explicitly asked for this CLI, so we
 * just try it once.
 */
async function runCustom(runner: Runner, args: RunArgs): Promise<number> {
  const caps = await runner.capabilities();
  if (!caps.installed) {
    process.stderr.write(
      `codep: custom provider \`${runner.id}\` is not installed: ${caps.detail ?? `\`${runner.displayName}\` binary not found on PATH`}\n`,
    );
    return 2;
  }
  if (!caps.authenticated) {
    process.stderr.write(
      `[codep] warn: custom provider \`${runner.id}\` appears unauthenticated; running anyway.\n`,
    );
  }

  if (args.explain) {
    process.stdout.write(
      `Routing decision:\n  provider:  ${runner.id} (custom)\n  reason:    forced by --model (custom provider)\n`,
    );
    if (args.passthroughArgs && args.passthroughArgs.length > 0) {
      process.stdout.write(
        `  passthrough: ${args.passthroughArgs.join(" ")}\n`,
      );
    }
    return 0;
  }

  if (args.dryRun) {
    const extra =
      args.passthroughArgs && args.passthroughArgs.length > 0
        ? ` -- ${args.passthroughArgs.join(" ")}`
        : "";
    process.stdout.write(
      `[codep] dry-run · provider=${runner.id} (custom) · ${runner.displayName}${extra}\n` +
        `[codep] prompt: ${JSON.stringify(args.prompt)}\n`,
    );
    return 0;
  }

  printHeader(args, runner.id as ProviderId, "forced by --model (custom)");

  const attemptStart = Date.now();
  const capture: string[] = [];
  const { exitCode, timedOut } = await executeRunner(
    runner,
    args,
    args.saveSession ? capture : undefined,
  );

  if (timedOut) {
    process.stderr.write(
      `[codep] error: provider \`${runner.id}\` timed out after ${args.timeoutSec}s.\n`,
    );
  }

  const entry: RunLogEntry = {
    ts: new Date(attemptStart).toISOString(),
    promptHash: hashPrompt(args.prompt),
    promptBytes: Buffer.byteLength(args.prompt, "utf8"),
    provider: runner.id,
    taskType: args.taskType ?? "general_chat",
    priority: args.priority,
    reason: "custom provider via --model",
    degraded: false,
    forcedModel: true,
    flags: {
      hasImage: args.hasImage,
      contextTokens: args.contextTokens,
      timeoutSec: args.timeoutSec,
      explain: args.explain,
      dryRun: args.dryRun,
    },
    exitCode,
    timedOut: timedOut || undefined,
    durationMs: Date.now() - attemptStart,
    codepVersion: CODEP_VERSION,
  };
  await appendRunLog(entry);

  if (args.saveSession) {
    const id = newSessionId();
    try {
      const path = await writeSession({
        id,
        ts: new Date(attemptStart).toISOString(),
        provider: runner.id,
        taskType: args.taskType ?? "general_chat",
        priority: args.priority,
        prompt: args.prompt,
        output: capture.join(""),
        exitCode,
        durationMs: Date.now() - attemptStart,
        codepVersion: CODEP_VERSION,
      });
      process.stderr.write(`[codep] session saved: ${id}  (${path})\n`);
    } catch (err) {
      process.stderr.write(
        `[codep] warn: failed to save session: ${err instanceof Error ? err.message : String(err)}\n`,
      );
    }
  }

  return exitCode;
}

interface WriteRunLogInput {
  args: RunArgs;
  decision: Extract<ReturnType<typeof route>, { kind: "ok" }>;
  classification: ClassifyResult | undefined;
  effectiveTaskType: TaskType | undefined;
  exitCode: number | undefined;
  timedOut: boolean;
  startedAt: number;
  attempt?: number;
  previousProvider?: ProviderId;
}

async function writeRunLog(input: WriteRunLogInput): Promise<void> {
  const { args, decision, classification, effectiveTaskType } = input;
  const entry: RunLogEntry = {
    ts: new Date().toISOString(),
    promptHash: hashPrompt(args.prompt),
    promptBytes: Buffer.byteLength(args.prompt, "utf8"),
    provider: decision.provider,
    taskType: effectiveTaskType ?? decision.taskType,
    priority: args.priority,
    reason: decision.reason,
    degraded: decision.degraded,
    idealProvider: decision.idealProvider,
    classifierSource: classification?.source,
    classifierConfidence: classification?.confidence,
    forcedModel: !!args.model,
    flags: {
      hasImage: args.hasImage,
      contextTokens: args.contextTokens,
      timeoutSec: args.timeoutSec,
      explain: args.explain,
      dryRun: args.dryRun,
    },
    exitCode: input.exitCode,
    timedOut: input.timedOut || undefined,
    durationMs: Date.now() - input.startedAt,
    attempt: input.attempt,
    previousProvider: input.previousProvider,
    codepVersion: CODEP_VERSION,
  };
  await appendRunLog(entry);
}
