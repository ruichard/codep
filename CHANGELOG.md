# Changelog

All notable changes to `codep` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- CLI skeleton with `commander`, default `run` subcommand and `doctor` subcommand.
- `Runner` interface and `CliSpawnRunner` generic driver for invoking vendor CLIs.
- Provider runners for Claude Code, OpenAI Codex CLI, and Gemini CLI.
- Availability detector with 1-hour cache; `doctor` shows installed / authenticated / healthy per provider with setup hints.
- Build-time `sync-models` script fetching [models.dev](https://models.dev/) and freezing a 14-model snapshot into `src/config/generated/models.generated.ts`.
- 15-task-type taxonomy and quality matrix used by the scorer.
- Router pipeline: availability filter → forced-provider short-circuit → hard constraints → scored pick → fallback policy.
- Heuristic task classifier with keyword-weighted rules, structural hints (image, context tokens), and a `source`/`confidence`/`reason` result.
- CLI flags: `--model`, `--type`, `--priority`, `--context-tokens`, `--image`, `--fallback`, `--explain`, `--dry-run`, `--timeout`, `--cwd`.
- JSONL run log at `~/.codep/runs.jsonl` (prompt hash only, never raw prompt).
- `codep logs` subcommand with `--limit` / `--json`; marks degraded (`*`) and forced-model (`!`) runs.
- `codep stats` subcommand aggregating provider/task-type counts, p50/p95 durations, and degradation edges.
- Stdin input (when piped) and `-f/--file <path...>` for attaching files to the prompt; context-token size is auto-estimated and feeds the router's context constraint.
- Configuration file support at `~/.codep/config.json` (global) and `./.codep.json` (project). Fields: `priority`, `fallbackPolicy`, `allowProviders`, `denyProviders`, `perTaskType`, `timeoutSec`.
- `codep config show` subcommand to print merged config and contributing files.
- `codep init [--global] [--force]` subcommand to scaffold a starter config file.
- `codep models [--model <p>] [--json]` subcommand to inspect the baked models.dev snapshot and provider profiles.
- Passthrough args: anything after a bare `--` on the `codep run` CLI is forwarded verbatim to the chosen vendor CLI.
- Runtime fallback: if the chosen provider exits non-zero (and it wasn't a timeout, SIGINT, or forced `--model`), codep automatically re-routes to the next-best candidate (up to 3 attempts). Disable with `--no-retry` or `--fallback=fail`.
- `codep stats` gains `--since <dur>` (e.g. `7d`, `24h`, ISO date), `--provider`, and `--type` filters, a retry counter, and a rough USD cost estimate based on each provider's flagship pricing.
- `codep logs` gains the same `--since`, `--provider`, and `--type` filters, and now marks runtime-fallback attempts with a `#N` suffix in the provider column.
- Session capture: `codep run --save-session` records the prompt, routing metadata, exit code, and the vendor CLI's stdout into `~/.codep/sessions/<id>.json`. New `codep sessions list` / `codep sessions show <id>` subcommands browse them.
- Lightweight conversation memory: `codep run -c/--continue` prepends the most recent saved session as context; `--resume <id>` targets a specific one. Context is injected client-side as a `--- previous request/response ---` block, so it works across vendors without relying on any provider's native resume.
- `codep doctor --json` emits machine-readable output (providers, config sources, log and session paths).
- `codep sessions rm <id>` deletes a single session; `codep sessions prune --older-than <dur> [--dry-run]` garbage-collects old sessions by file mtime.
- Custom providers: declare any extra CLI-based coding agent (e.g. `aider`, `cursor-agent`, `opencode`) in `.codep.json` under a `providers` object. Invocable via `--model <id>` only — they never participate in auto-routing. `{prompt}` placeholder substitution in the args template; `authEnvVars` / `authPaths` / `versionArgs` feed into `doctor`, which lists them in a dedicated row.
- `codep tui [--refresh <sec>]` — interactive Ink-based dashboard showing provider health, a stats panel (runs / failures / timeouts / retries / degraded / est. cost / sessions), and a recent-runs table. Keyboard shortcuts: `q` quit, `r` refresh, `1`/`3`/`7`/`a` to switch the time window between 24h / 3d / 7d / all-time. Ink and React are lazy-loaded only when `codep tui` is invoked, and kept external from the main bundle so other commands stay fast.
- `codep plan "<prompt>" [--providers a,b,c] [--save-session] [--json]` — parallel multi-provider execution: runs the same prompt across every specified provider CLI at once (defaulting to all installed+authenticated built-ins) and renders a side-by-side comparison with durations, exit status, and an output preview. Works with both built-in and custom providers; each run is appended to the shared run log, and `--save-session` writes one session per provider so they can be diffed with `codep sessions show`.
- LLM-assisted classifier. New config fields `classifier` (`"heuristic"` | `"llm"` | `"auto"`, default `"heuristic"`), `classifierProvider`, `classifierConfidenceThreshold` (default `0.4`), and `classifierTimeoutMs` (default `10000`) let `codep` escalate low-confidence heuristic classifications to a cheap provider CLI call. The classifier asks for a two-line `taskType` / `confidence` reply, times out conservatively, and silently falls back to the heuristic on any failure so routing is never blocked. Logged via the existing `classifierSource: "llm"` field.
- TUI drill-down: `codep tui` is now multi-view. From the dashboard, `l` opens a navigable logs list and `s` opens a sessions list. Use `↑/↓` to move and `enter` to inspect: a run's full routing metadata, or a session's captured prompt and output. `esc` pops back. Window-filter keys (`1`/`3`/`7`/`a`) still apply in the dashboard and logs views.
- Windows support. `CliSpawnRunner` no longer shells out to POSIX `which`; binary resolution walks `PATH` in-process and honors `PATHEXT` on Windows so npm-installed `.cmd` / `.bat` / `.ps1` shims (e.g. `claude.cmd`, `codex.cmd`, `gemini.cmd`) are located correctly. `.cmd` / `.bat` / `.ps1` shims are invoked via `shell: true` to sidestep Node's CVE-2024-27980 mitigation, and the CI matrix now includes `windows-latest` alongside Linux and macOS.
- `codep doctor` now also reports loaded config files and the log path.
- `codep --version` now matches `package.json` automatically (tsup `define`).
- Hard timeout enforcement; runner surfaces a `timedOut` signal back to the caller.
- Vitest unit tests for scorer, constraints, pipeline, classifier, and run log.

[Unreleased]: https://github.com/codep-dev/codep/compare/HEAD...HEAD
