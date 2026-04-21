/**
 * Shell completion scripts for codep.
 *
 * We ship static scripts rather than a dynamic completion protocol — the
 * subcommand list is tiny and changes rarely, so hand-written snippets are
 * simpler and don't require spawning `codep` on every tab press.
 */

const SUBCOMMANDS = [
  "run",
  "doctor",
  "logs",
  "stats",
  "models",
  "config",
  "init",
  "tui",
  "plan",
  "sessions",
  "completion",
  "help",
];

const GLOBAL_FLAGS = ["--help", "--version"];

function bash(): string {
  const cmds = SUBCOMMANDS.join(" ");
  return `# codep bash completion
_codep_completion() {
  local cur prev words cword
  _init_completion 2>/dev/null || {
    cur="\${COMP_WORDS[COMP_CWORD]}"
    prev="\${COMP_WORDS[COMP_CWORD-1]}"
  }
  local subcommands="${cmds}"
  if [ "\${COMP_CWORD}" -eq 1 ]; then
    COMPREPLY=( $(compgen -W "\${subcommands} ${GLOBAL_FLAGS.join(" ")}" -- "\${cur}") )
    return
  fi
  # Leave arg completion to default file completion after the subcommand.
  COMPREPLY=( $(compgen -f -- "\${cur}") )
}
complete -F _codep_completion codep
`;
}

function zsh(): string {
  const cmdsWithDescriptions = [
    "run:Route a prompt to the best provider (default)",
    "doctor:Check which provider CLIs are installed",
    "logs:Show recent routing decisions",
    "stats:Aggregate run statistics",
    "models:Inspect baked model snapshot",
    "config:Show or manage codep config",
    "init:Create a starter .codep.json",
    "tui:Interactive dashboard",
    "plan:Run a prompt in parallel on multiple providers",
    "sessions:List / show / prune captured sessions",
    "completion:Print shell completion script",
    "help:Display help",
  ];
  const body = cmdsWithDescriptions.map((s) => `    '${s}'`).join(" \\\n");
  return `#compdef codep
# codep zsh completion
_codep() {
  local -a subcommands
  subcommands=( \\
${body} \\
  )
  if (( CURRENT == 2 )); then
    _describe 'codep command' subcommands
    _arguments '--help[Show help]' '--version[Print version]'
  else
    _files
  fi
}
_codep "$@"
`;
}

function fish(): string {
  const lines = SUBCOMMANDS.map(
    (c) => `complete -c codep -n "__fish_use_subcommand" -a "${c}"`,
  ).join("\n");
  return `# codep fish completion
${lines}
complete -c codep -l help -d "Show help"
complete -c codep -l version -d "Print version"
`;
}

export function completionScript(shell: string): string | undefined {
  switch (shell) {
    case "bash":
      return bash();
    case "zsh":
      return zsh();
    case "fish":
      return fish();
    default:
      return undefined;
  }
}

export function completionInstallHint(shell: string): string {
  switch (shell) {
    case "bash":
      return [
        "# Add to ~/.bashrc:",
        '  source <(codep completion bash)',
        "# Or dump to a file that your completion loader reads:",
        '  codep completion bash > /usr/local/etc/bash_completion.d/codep',
      ].join("\n");
    case "zsh":
      return [
        "# Ensure ~/.zshrc enables completion once:",
        "  autoload -Uz compinit && compinit",
        "# Then drop the script into a fpath directory, e.g.:",
        "  codep completion zsh > \"${fpath[1]}/_codep\"",
        "# Or source it inline in ~/.zshrc:",
        '  source <(codep completion zsh)',
      ].join("\n");
    case "fish":
      return [
        "# Persist the completion to fish's user completions dir:",
        "  codep completion fish > ~/.config/fish/completions/codep.fish",
      ].join("\n");
    default:
      return `Unsupported shell: ${shell}. Supported: bash, zsh, fish.`;
  }
}
