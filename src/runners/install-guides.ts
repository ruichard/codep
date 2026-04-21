import type { ProviderId } from "../runners/base.js";

export interface InstallGuide {
  install: string;
  login: string;
  docs: string;
}

export const INSTALL_GUIDES: Record<ProviderId, InstallGuide> = {
  claude: {
    install:
      "curl -fsSL https://claude.ai/install.sh | bash   # or: brew install --cask claude-code",
    login: "claude   # then follow the OAuth prompt",
    docs: "https://code.claude.com/docs/en/setup",
  },
  codex: {
    install: "brew install codex   # or: npm i -g @openai/codex",
    login: "codex login",
    docs: "https://github.com/openai/codex",
  },
  gemini: {
    install: "brew install gemini-cli   # or: npm i -g @google/gemini-cli",
    login: "gemini   # then follow the OAuth prompt",
    docs: "https://github.com/google-gemini/gemini-cli",
  },
};
