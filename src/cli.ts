import { Command } from "commander";
import { doctorCommand } from "./commands/doctor.js";
import { logsCommand } from "./commands/logs.js";
import { runCommand } from "./commands/run.js";
import { statsCommand } from "./commands/stats.js";
import { configShowCommand } from "./commands/config.js";
import { initCommand } from "./commands/init.js";
import { modelsCommand } from "./commands/models.js";
import { planCommand } from "./commands/plan.js";
import { sessionsCommand, sessionsPrune, sessionsRm } from "./commands/sessions.js";
import type { ProviderId } from "./runners/base.js";
import { ALL_PROVIDERS } from "./runners/base.js";
import { isTaskType, TASK_TYPES, type TaskType } from "./router/taxonomy.js";
import type { FallbackPolicy } from "./router/pipeline.js";
import { assemblePrompt, readStdin } from "./input/assemble.js";
import { loadConfig } from "./config/load.js";
import { buildCustomRunners } from "./runners/custom.js";
import { latestSessionId, readSession } from "./session/store.js";
import { CODEP_VERSION } from "./version.js";
import { completionInstallHint, completionScript } from "./commands/completion.js";

const program = new Command();

program
  .name("codep")
  .description(
    "Route coding tasks to the best official CLI (Claude / Codex / Gemini).",
  )
  .version(CODEP_VERSION);

program
  .command("doctor")
  .description(
    "Check which provider CLIs are installed, authenticated, and healthy.",
  )
  .option("--json", "emit machine-readable JSON")
  .action(async (opts: { json?: boolean }) => {
    const code = await doctorCommand({ json: !!opts.json });
    process.exit(code);
  });

program
  .command("logs")
  .description("Show recent routing decisions and runs.")
  .option("-n, --limit <n>", "max entries to show", (v) => Number(v), 20)
  .option("--json", "emit JSON lines instead of a table")
  .option("--since <duration>", "only include runs newer than e.g. 7d, 24h, 30m, or ISO date")
  .option("--provider <id>", `limit to one provider (${ALL_PROVIDERS.join("|")})`)
  .option("--type <task_type>", "limit to one task type")
  .action(
    async (opts: {
      limit: number;
      json?: boolean;
      since?: string;
      provider?: string;
      type?: string;
    }) => {
      const code = await logsCommand({
        limit: opts.limit,
        json: !!opts.json,
        since: opts.since,
        provider: opts.provider,
        type: opts.type,
      });
      process.exit(code);
    },
  );

program
  .command("stats")
  .description("Aggregate statistics over ~/.codep/runs.jsonl.")
  .option("--json", "emit the summary as JSON")
  .option("--since <duration>", "only include runs newer than e.g. 7d, 24h, 30m, or ISO date")
  .option("--provider <id>", `limit to one provider (${ALL_PROVIDERS.join("|")})`)
  .option("--type <task_type>", "limit to one task type")
  .action(
    async (opts: {
      json?: boolean;
      since?: string;
      provider?: string;
      type?: string;
    }) => {
      const code = await statsCommand({
        json: !!opts.json,
        since: opts.since,
        provider: opts.provider,
        type: opts.type,
      });
      process.exit(code);
    },
  );

program
  .command("models")
  .description("List the baked models.dev snapshot and provider profiles.")
  .option(
    "-m, --model <provider>",
    `limit to one provider (${ALL_PROVIDERS.join("|")})`,
  )
  .option("--json", "emit as JSON")
  .action(async (opts: { model?: string; json?: boolean }) => {
    if (opts.model && !ALL_PROVIDERS.includes(opts.model as ProviderId)) {
      process.stderr.write(
        `codep: unknown provider "${opts.model}". Expected one of: ${ALL_PROVIDERS.join(", ")}\n`,
      );
      process.exit(2);
    }
    const code = await modelsCommand({
      provider: opts.model as ProviderId | undefined,
      json: !!opts.json,
    });
    process.exit(code);
  });

const configCmd = program
  .command("config")
  .description("Inspect codep configuration.");

configCmd
  .command("show")
  .description("Print the merged configuration and which files contributed.")
  .option("--json", "emit as JSON")
  .action(async (opts: { json?: boolean }) => {
    const code = await configShowCommand({ json: !!opts.json });
    process.exit(code);
  });

program
  .command("init")
  .description("Scaffold a codep config file (project-scoped by default).")
  .option("--global", "write to ~/.codep/config.json instead of ./.codep.json")
  .option("--force", "overwrite if the file already exists")
  .action(async (opts: { global?: boolean; force?: boolean }) => {
    const code = await initCommand({
      scope: opts.global ? "global" : "project",
      force: !!opts.force,
    });
    process.exit(code);
  });

program
  .command("tui")
  .description("Launch an interactive dashboard (provider health, stats, recent runs).")
  .option(
    "--refresh <seconds>",
    "auto-refresh interval in seconds",
    (v) => Number(v),
    5,
  )
  .action(async (opts: { refresh: number }) => {
    const refreshMs = Math.max(1, Math.floor(opts.refresh)) * 1000;
    // Dynamic import keeps ink/react out of the hot path (run/doctor/logs).
    const { tuiCommand } = await import("./commands/tui.js");
    const code = await tuiCommand({ refreshMs });
    process.exit(code);
  });

program
  .command("plan <prompt>")
  .description(
    "Run the same prompt across multiple providers in parallel and compare outputs.",
  )
  .option(
    "--providers <list>",
    "comma-separated provider ids (defaults to all installed+authenticated built-ins)",
  )
  .option("--timeout <sec>", "per-provider wall-clock timeout", (v) => Number(v))
  .option("--cwd <path>", "working directory for each child CLI")
  .option("--save-session", "save each provider's output as a session")
  .option("--preview-chars <n>", "chars of output to preview per provider", (v) => Number(v), 800)
  .option("--json", "emit full JSON (includes captured outputs)")
  .action(
    async (
      prompt: string,
      opts: {
        providers?: string;
        timeout?: number;
        cwd?: string;
        saveSession?: boolean;
        previewChars: number;
        json?: boolean;
      },
    ) => {
      const providers = opts.providers
        ? opts.providers
            .split(",")
            .map((s) => s.trim())
            .filter((s) => s.length > 0)
        : undefined;
      const code = await planCommand({
        prompt,
        providers,
        timeoutSec: opts.timeout,
        cwd: opts.cwd,
        saveSession: !!opts.saveSession,
        previewChars: opts.previewChars,
        json: !!opts.json,
      });
      process.exit(code);
    },
  );

const sessionsCmd = program
  .command("sessions")
  .description("Browse saved run sessions under ~/.codep/sessions/.");
sessionsCmd
  .command("list")
  .description("List recent saved sessions (newest first).")
  .option("-n, --limit <n>", "max entries to show", (v) => Number(v), 20)
  .option("--json", "emit JSON lines instead of a table")
  .action(async (opts: { limit: number; json?: boolean }) => {
    const code = await sessionsCommand({
      sub: "list",
      limit: opts.limit,
      json: !!opts.json,
    });
    process.exit(code);
  });
sessionsCmd
  .command("show <id>")
  .description("Print a saved session's prompt and captured output.")
  .option("--json", "emit the raw JSON record")
  .action(async (id: string, opts: { json?: boolean }) => {
    const code = await sessionsCommand({
      sub: "show",
      id,
      json: !!opts.json,
    });
    process.exit(code);
  });
sessionsCmd
  .command("rm <id>")
  .description("Delete a single saved session.")
  .action(async (id: string) => {
    const code = await sessionsRm(id);
    process.exit(code);
  });
sessionsCmd
  .command("prune")
  .description("Delete sessions older than a given duration.")
  .requiredOption("--older-than <dur>", "e.g. 30d, 7d, or an ISO date")
  .option("--dry-run", "list what would be removed without deleting")
  .action(async (opts: { olderThan: string; dryRun?: boolean }) => {
    const code = await sessionsPrune({
      olderThan: opts.olderThan,
      dryRun: !!opts.dryRun,
    });
    process.exit(code);
  });

const PRIORITIES = ["quality", "balanced", "cheap"] as const;
const POLICIES: readonly FallbackPolicy[] = ["auto", "warn", "fail"] as const;

program
  .command("completion [shell]")
  .description("Print a shell completion script (bash|zsh|fish).")
  .action((shellArg?: string) => {
    const shell = shellArg ?? detectShell();
    if (!shell) {
      process.stderr.write(
        "codep completion: could not detect your shell — pass one explicitly: bash | zsh | fish\n",
      );
      process.exit(2);
    }
    const script = completionScript(shell);
    if (!script) {
      process.stderr.write(
        `codep completion: unsupported shell "${shell}" (supported: bash, zsh, fish)\n`,
      );
      process.exit(2);
    }
    // Write to stdout so it can be piped straight into a file or sourced.
    process.stdout.write(script);
    // When printed to a terminal, append install hints as a trailing comment
    // block so humans see how to hook it up.
    if (process.stdout.isTTY) {
      process.stdout.write(
        "\n" +
          completionInstallHint(shell)
            .split("\n")
            .map((l) => (l.startsWith("#") ? l : `# ${l}`))
            .join("\n") +
          "\n",
      );
    }
  });

function detectShell(): string | undefined {
  const shellEnv = process.env.SHELL ?? "";
  if (shellEnv.includes("zsh")) return "zsh";
  if (shellEnv.includes("bash")) return "bash";
  if (shellEnv.includes("fish")) return "fish";
  return undefined;
}

program
  .command("run", { isDefault: true })
  .description("Run a coding task (one-shot).")
  .argument("[prompt...]", "task description (may be empty if stdin/--file is used)")
  .option(
    "-m, --model <provider>",
    `force a specific provider (${ALL_PROVIDERS.join("|")})`,
  )
  .option(
    "-t, --type <task_type>",
    `explicit task type (${TASK_TYPES.join("|")})`,
  )
  .option(
    "-p, --priority <level>",
    `routing priority (${PRIORITIES.join("|")}, default: quality)`,
  )
  .option(
    "-f, --file <path>",
    "attach a file as additional context (repeatable)",
    (value: string, previous: string[] = []) => [...previous, value],
    [] as string[],
  )
  .option(
    "--context-tokens <n>",
    "override estimated input tokens (auto-estimated by default)",
    (v) => Number(v),
  )
  .option("--image", "task includes image/PDF input (requires vision)")
  .option(
    "--fallback <policy>",
    `fallback policy (${POLICIES.join("|")}, default: warn)`,
  )
  .option("--explain", "print routing decision without running")
  .option("--dry-run", "print what would be invoked without spawning")
  .option("--no-retry", "disable runtime fallback to another provider on failure")
  .option("--save-session", "capture the vendor CLI's stdout into ~/.codep/sessions/")
  .option("-c, --continue", "prepend the most recent saved session as context")
  .option("--resume <id>", "prepend a specific saved session as context")
  .option("--cwd <path>", "working directory for the child CLI")
  .option("--timeout <sec>", "hard timeout in seconds", (v) => Number(v))
  .action(
    async (
      promptParts: string[],
      opts: {
        model?: string;
        type?: string;
        priority?: string;
        file?: string[];
        contextTokens?: number;
        image?: boolean;
        fallback?: string;
        explain?: boolean;
        dryRun?: boolean;
        retry?: boolean;
        saveSession?: boolean;
        continue?: boolean;
        resume?: string;
        cwd?: string;
        timeout?: number;
      },
    ) => {
      const userPrompt = (promptParts ?? []).join(" ").trim();
      const stdin = await readStdin();

      let previousExchange;
      if (opts.resume || opts.continue) {
        const resumeId = opts.resume ?? (await latestSessionId());
        if (!resumeId) {
          process.stderr.write(
            "codep: no saved sessions yet; use `--save-session` on a prior run.\n",
          );
          process.exit(2);
        }
        const rec = await readSession(resumeId);
        if (!rec) {
          process.stderr.write(`codep: session \`${resumeId}\` not found.\n`);
          process.exit(2);
        }
        previousExchange = {
          id: rec.id,
          prompt: rec.prompt,
          output: rec.output,
        };
      }

      let assembled;
      try {
        assembled = await assemblePrompt({
          userPrompt,
          stdin,
          files: opts.file,
          previousExchange,
        });
      } catch (err) {
        process.stderr.write(
          `codep: failed to read input: ${err instanceof Error ? err.message : String(err)}\n`,
        );
        process.exit(2);
      }
      if (!assembled.prompt) {
        process.stderr.write("codep: empty prompt (pass text, pipe stdin, or use --file).\n");
        process.exit(2);
      }

      let cfg;
      try {
        cfg = (await loadConfig({ cwd: opts.cwd })).config;
      } catch (err) {
        process.stderr.write(
          `codep: config error: ${err instanceof Error ? err.message : String(err)}\n`,
        );
        process.exit(2);
      }

      if (opts.model && !ALL_PROVIDERS.includes(opts.model as ProviderId)) {
        const customIds = Object.keys(cfg.providers ?? {});
        if (!customIds.includes(opts.model)) {
          process.stderr.write(
            `codep: unknown provider "${opts.model}". Expected one of: ${[
              ...ALL_PROVIDERS,
              ...customIds,
            ].join(", ")}\n`,
          );
          process.exit(2);
        }
      }
      let taskType: TaskType | undefined;
      if (opts.type !== undefined) {
        if (!isTaskType(opts.type)) {
          process.stderr.write(
            `codep: unknown --type "${opts.type}". Expected one of: ${TASK_TYPES.join(", ")}\n`,
          );
          process.exit(2);
        }
        taskType = opts.type;
      }
      const priority = (opts.priority ?? cfg.priority ?? "quality") as (typeof PRIORITIES)[number];
      if (!PRIORITIES.includes(priority)) {
        process.stderr.write(
          `codep: unknown --priority "${opts.priority}". Expected one of: ${PRIORITIES.join(", ")}\n`,
        );
        process.exit(2);
      }
      const fallback = (opts.fallback ?? cfg.fallbackPolicy ?? "warn") as FallbackPolicy;
      if (!POLICIES.includes(fallback)) {
        process.stderr.write(
          `codep: unknown --fallback "${opts.fallback}". Expected one of: ${POLICIES.join(", ")}\n`,
        );
        process.exit(2);
      }
      const code = await runCommand({
        prompt: assembled.prompt,
        model: opts.model,
        taskType,
        priority,
        cwd: opts.cwd,
        timeoutSec: opts.timeout ?? cfg.timeoutSec,
        contextTokens: opts.contextTokens ?? assembled.contextTokens,
        contextSources: assembled.sources,
        hasImage: !!opts.image,
        fallbackPolicy: fallback,
        explain: !!opts.explain,
        dryRun: !!opts.dryRun,
        noRetry: opts.retry === false,
        saveSession: !!opts.saveSession,
        allowProviders: cfg.allowProviders,
        denyProviders: cfg.denyProviders,
        perTaskType: cfg.perTaskType,
        passthroughArgs,
        customRunners: buildCustomRunners(cfg.providers ?? {}),
        classifier: cfg.classifier,
        classifierProvider: cfg.classifierProvider,
        classifierConfidenceThreshold: cfg.classifierConfidenceThreshold,
        classifierTimeoutMs: cfg.classifierTimeoutMs,
      });
      process.exit(code);
    },
  );

// Split process.argv on the first bare `--`. Anything after it is forwarded
// to the vendor CLI as-is. We must strip it before commander parses, because
// commander would otherwise absorb the tail into the variadic `[prompt...]`.
const rawArgv = process.argv.slice();
let passthroughArgs: string[] = [];
const dashDashIdx = rawArgv.indexOf("--", 2);
if (dashDashIdx !== -1) {
  passthroughArgs = rawArgv.slice(dashDashIdx + 1);
  rawArgv.splice(dashDashIdx);
}

program.parseAsync(rawArgv).catch((err) => {
  process.stderr.write(
    `codep: fatal: ${err instanceof Error ? err.message : String(err)}\n`,
  );
  process.exit(1);
});
