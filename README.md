# codep

[![ci](https://github.com/ruichard/codep/actions/workflows/ci.yml/badge.svg)](https://github.com/ruichard/codep/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@ruichard/codep.svg)](https://www.npmjs.com/package/@ruichard/codep)
[![license: AGPL-3.0-only](https://img.shields.io/badge/license-AGPL--3.0--only-blue.svg)](./LICENSE)

**Route coding tasks to the most suitable official CLI** — Claude Code, OpenAI Codex CLI, or Gemini CLI — and stream the result back.

`codep` reads your prompt, classifies the task, checks which provider CLIs you already have installed & authenticated, scores them on a per-task-type quality × cost matrix, and spawns the winner. You keep your existing logins; no API keys are proxied through `codep`.

> **Status:** pre-alpha. APIs, flags, and the scoring matrix may change without notice.

## Why

| You want to … | Without `codep` | With `codep` |
| --- | --- | --- |
| Pick the best CLI for a refactor | Remember which one is best today | `codep "refactor X"` |
| Keep using vendor CLIs directly | Fine | Still fine — `codep` is additive |
| See *why* a choice was made | n/a | `codep --explain …` |
| Force a specific provider | Type its CLI | `codep --model codex …` |
| Audit past routing decisions | n/a | `codep logs` |

## Install

Node.js ≥ 20 required. Works on macOS, Linux, and Windows (PowerShell / cmd / Git Bash). You must also install and log in to at least one provider CLI:

- **Claude Code** — `npm i -g @anthropic-ai/claude-code` · `claude login`
- **OpenAI Codex CLI** — `brew install codex` · `codex login`
- **Gemini CLI** — `npm i -g @google/gemini-cli` · `gemini`

Then:

```sh
# one-off, no install
pnpm dlx @ruichard/codep doctor        # or: npx @ruichard/codep doctor

# or install globally (adds a `codep` binary to PATH)
npm i -g @ruichard/codep
codep doctor                 # see what's installed/authenticated

# or on macOS / Linux via Homebrew:
brew install ruichard/codep/codep
```

### Shell completion

Enable tab-completion for subcommands:

```sh
# zsh
codep completion zsh > "${fpath[1]}/_codep" && compinit

# bash
echo 'source <(codep completion bash)' >> ~/.bashrc

# fish
codep completion fish > ~/.config/fish/completions/codep.fish
```

## Usage

### One-shot run

```sh
codep "refactor the error handling in src/http/"
codep "solve this DP problem in Python"
codep "summarize the entire codebase" --type long_context_qa
codep --model codex "generate tests for src/parser.ts"
codep --explain "rewrite the CSS to use grid"   # print decision, don't run
codep --dry-run "anything"                       # show what would spawn

# Pipe stdin or attach files:
cat src/parser.ts | codep "add vitest unit tests"
codep -f src/a.ts -f src/b.ts "review these for bugs"

# Forward provider-specific flags after `--`:
codep --model codex "run this" -- --model gpt-5-codex
```

### Flags

| Flag | Meaning |
| --- | --- |
| `-m, --model <provider>` | Force `claude`, `codex`, or `gemini`. |
| `-t, --type <task_type>` | Skip classifier; see `codep --help` for values. |
| `-p, --priority <level>` | `quality` (default), `balanced`, or `cheap`. |
| `-f, --file <path...>` | Attach one or more files as additional prompt context. |
| `--context-tokens <n>` | Override the auto-estimated input size. |
| `--image` | Mark task as multimodal (requires vision). |
| `--fallback <policy>` | `auto`, `warn` (default), or `fail` when ideal provider is unavailable. |
| `--no-retry` | Disable runtime fallback to another provider on non-zero exit. |
| `--save-session` | Capture the vendor CLI's stdout into `~/.codep/sessions/<id>.json`. |
| `-c, --continue` | Prepend the most recent saved session as context. |
| `--resume <id>` | Prepend a specific saved session as context. |
| `--explain` | Print the routing decision and exit. |
| `--dry-run` | Print what would be invoked; don't spawn. |
| `--timeout <sec>` | Hard wall-clock timeout for the child CLI. |

### Subcommands

- `codep doctor [--json]` — installed / authenticated / healthy table for each provider, with setup hints. Also shows which config files are loaded. Pass `--json` for machine-readable output.
- `codep init [--global] [--force]` — scaffold a starter `.codep.json` (project-scoped by default).
- `codep logs [--limit N] [--json] [--since <dur>] [--provider <id>] [--type <task_type>]` — recent routing decisions from `~/.codep/runs.jsonl`. Prompt content is **not** logged; only a 16-char SHA-256 prefix.
- `codep stats [--json] [--since <dur>] [--provider <id>] [--type <task_type>]` — aggregate provider/task-type counts, p50/p95 durations, retry counts, rough cost estimates, and top degradation edges over your local log.
- `codep sessions list [-n N] [--json]` / `codep sessions show <id>` / `codep sessions rm <id>` / `codep sessions prune --older-than <dur> [--dry-run]` — browse and garbage-collect saved sessions (`~/.codep/sessions/*.json`). Enable capture with `--save-session` on any `codep run`.
- `codep config show [--json]` — print the merged configuration and which files contributed.
- `codep models [--model <p>] [--json]` — inspect the baked [models.dev](https://models.dev/) snapshot and per-provider profiles used by the scorer.
- `codep tui [--refresh <sec>]` — interactive dashboard with multiple views: provider health, stats, recent runs, full logs list, and the saved-sessions browser. Keys (dashboard): `q` quit · `r` refresh · `l` open logs view · `s` open sessions view · `1`/`3`/`7`/`a` switch window to 24h / 3d / 7d / all-time. In **logs** view: `↑/↓` to move, `enter` to inspect a single run's full metadata. In **sessions** view: `↑/↓` to move, `enter` to open a session and read its captured prompt + output. `esc` always pops back one level.
- `codep plan "<prompt>" [--providers a,b,c] [--timeout <sec>] [--save-session] [--json]` — run the same prompt across multiple provider CLIs **in parallel** and compare their outputs side-by-side. Built-ins and custom providers both work. Defaults to every installed+authenticated built-in. Each run is logged, and `--save-session` writes one session per provider so you can diff them later with `codep sessions show <id>`.

## Configuration

`codep` reads JSON configuration from two locations, merged in order (project wins):

1. Global: `~/.codep/config.json`
2. Project: `./.codep.json` (walked up from the working directory)

All fields are optional. CLI flags always override config values.

```json
{
  "priority": "balanced",
  "fallbackPolicy": "warn",
  "denyProviders": ["gemini"],
  "perTaskType": { "ui_frontend": "claude" },
  "timeoutSec": 120
}
```

| Field | Effect |
| --- | --- |
| `priority` | Default for `--priority`. |
| `fallbackPolicy` | Default for `--fallback`. |
| `allowProviders` | Whitelist; only these providers are eligible (unless `--model` forces). |
| `denyProviders` | Blacklist; these providers are never picked (unless `--model` forces). |
| `perTaskType` | Force a specific provider for a given task type. |
| `timeoutSec` | Default for `--timeout`. |
| `providers` | Declare **custom** coding-agent CLIs. See below. |
| `classifier` | `"heuristic"` (default), `"llm"`, or `"auto"`. See "LLM-assisted classification" below. |
| `classifierProvider` | Preferred provider for LLM classification. Defaults to the cheapest available. |
| `classifierConfidenceThreshold` | In `auto` mode, escalate to the LLM when heuristic confidence is below this value. Default `0.4`. |
| `classifierTimeoutMs` | Hard timeout for the classifier call in ms. Default `10000`. |

### LLM-assisted classification

By default, `codep` classifies prompts with a fast, offline keyword heuristic.
Setting `classifier` in `.codep.json` enables an LLM-backed second opinion:

```json
{
  "classifier": "auto",
  "classifierProvider": "gemini",
  "classifierConfidenceThreshold": 0.45
}
```

- `"heuristic"` — keyword rules only (current default, zero latency, zero cost).
- `"llm"` — always call the LLM. Falls back to the heuristic if the provider
  is unavailable or the call fails.
- `"auto"` — use the heuristic first; escalate to the LLM only when the
  heuristic's confidence is below `classifierConfidenceThreshold`.

The classifier prompt is short and asks the provider to respond with
`taskType: <name>` and `confidence: <0..1>`. Any failure (timeout, non-zero
exit, unparseable reply) logs a warning and silently degrades back to the
heuristic result — routing is never blocked.

### Custom providers

Any CLI-based coding agent can be plugged in by declaring it under `providers`.
Custom providers are **only invocable via `--model <id>`** — they never
participate in auto-routing or classification.

```json
{
  "providers": {
    "aider": {
      "bin": "aider",
      "args": ["--message", "{prompt}"],
      "authEnvVars": ["OPENAI_API_KEY", "ANTHROPIC_API_KEY"]
    },
    "cursor-agent": {
      "displayName": "Cursor Agent",
      "bin": "cursor-agent",
      "args": ["run"],
      "authPaths": [".cursor/auth.json"],
      "versionArgs": ["--version"]
    }
  }
}
```

| Field | Effect |
| --- | --- |
| `bin` | Executable name or absolute path. Resolved on `PATH`. |
| `args` | Argv template. `{prompt}` is substituted; if absent the prompt is appended. |
| `displayName` | Optional pretty name (defaults to the id). |
| `authEnvVars` | Env vars that, if any is set, mark the provider authenticated. |
| `authPaths` | Paths (relative to `$HOME`) that, if any exists, mark it authenticated. |
| `versionArgs` | Args passed to `bin` to print a version in `doctor` (default `["--version"]`). |

Ids must match `^[a-z][a-z0-9-]*$` and cannot collide with built-ins
(`claude`, `codex`, `gemini`). Use via:

```sh
codep --model aider "refactor utils.ts" -- --yes
codep doctor   # lists custom providers in a separate row
```

## How routing works

1. **Classify** the prompt → one of 15 task types (refactor, algorithm, long_context_qa, multimodal_to_code, …). Heuristic today; LLM-assist later.
2. **Availability filter.** Which provider CLIs are installed *and* authenticated?
3. **Hard constraints.** Context window ≥ hint? Vision required?
4. **Score** each surviving candidate: `100·quality(taskType, provider) − α(priority)·avgCostPerMTok`. Highest wins.
5. **Fallback policy.** If the *ideal* (all-providers-available) pick was pruned, honor `--fallback`:
   - `auto` → silently switch
   - `warn` → switch + print note (default)
   - `fail` → abort

`codep --explain` prints all of this.

## Design

- **Zero runtime lock-in.** `codep` invokes vendor CLIs you already installed. Remove `codep` at any time.
- **Runner interface.** `CliSpawnRunner` today; room for `ApiRunner` later under the same contract.
- **Frozen models snapshot.** Model metadata ships baked into the binary (generated from [models.dev](https://models.dev/)). Regenerate with `pnpm sync-models`.
- **Privacy.** Prompts are streamed to the chosen provider CLI — same trust boundary as if you typed there directly. Local logs store only prompt hashes.

## Develop

```sh
pnpm install
pnpm build
pnpm test
node ./dist/cli.js doctor
node ./dist/cli.js --explain "refactor X"
```

Handy scripts:

```sh
pnpm typecheck        # tsc --noEmit
pnpm sync-models      # refresh src/config/generated/models.generated.ts
pnpm test:watch
```

Project layout:

```
src/
  cli.ts                 # commander entry
  commands/              # doctor, run, logs
  router/                # classifier, scorer, profiles, pipeline
  runners/               # CliSpawnRunner + registry per provider
  log/                   # ~/.codep/runs.jsonl
  config/generated/      # baked models.dev snapshot
tests/
scripts/sync-models.ts   # build-time model metadata fetch
```

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md). All commits must be DCO-signed (`git commit -s`).

## License

[AGPL-3.0-only](./LICENSE). If you run `codep` as a network service, you must make the source available to users of that service.

