# Contributing to codep

Thanks for taking the time to contribute.

## Ground rules

- **DCO, not CLA.** Every commit must carry `Signed-off-by:` — use `git commit -s`. See <https://developercertificate.org/>. We do **not** require a CLA; you retain copyright.
- **License.** codep is [AGPL-3.0-only](./LICENSE). Contributions are under the same license. If your employer or country requires something different, please open an issue first.
- **Scope.** Phase 1 targets the three flagship closed-source CLIs (Claude Code, Codex CLI, Gemini CLI). Broader provider support is tracked in the phase plan; please discuss before sending a PR.

## Dev setup

Requirements: **Node.js ≥ 20**, **pnpm ≥ 9**.

```sh
pnpm install
pnpm build
pnpm test
pnpm typecheck
```

Run the CLI during development:

```sh
node ./dist/cli.js doctor
node ./dist/cli.js --explain "refactor error handling"
```

Regenerate the baked `models.dev` snapshot (no API key needed):

```sh
pnpm sync-models
```

## Pull requests

1. Fork, branch off `main`, keep the PR focused.
2. `pnpm test && pnpm typecheck` must pass locally.
3. Add tests for new behavior — `tests/` uses vitest.
4. Update `CHANGELOG.md` under **Unreleased**.
5. Commits signed off (`-s`). PR title follows [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `docs:`, `refactor:`, `chore:`, `test:`).
6. For anything touching the scoring matrix or task taxonomy, please include rationale in the PR description — those are user-visible behavior changes.

## Reporting bugs

Open an issue with:

- output of `codep doctor`
- the command you ran (redact prompt if needed — `codep` already hashes prompts in logs)
- `codep --explain` output for the same prompt
- `node --version`, OS

## Security

For security-sensitive issues, please do not open a public issue. Contact the maintainers directly (see repo metadata).
