import { readFile } from "node:fs/promises";

/**
 * Rough token estimator. We use 4 chars/token as a cross-model approximation
 * (close enough for routing decisions — constraints care about order of
 * magnitude, not exact token counts).
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Read all of process.stdin as UTF-8 text. Returns "" if stdin is a TTY. */
export async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return "";
  process.stdin.setEncoding("utf8");
  const chunks: string[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as string);
  return chunks.join("");
}

export interface AssembledPrompt {
  prompt: string;
  contextTokens: number;
  /** Sources that contributed to the prompt, for --explain. */
  sources: string[];
}

export interface AssemblePromptInput {
  userPrompt: string;
  stdin?: string;
  files?: readonly string[];
  /** Previous session to prepend as context (for -c/--continue / --resume). */
  previousExchange?: {
    id: string;
    prompt: string;
    output: string;
  };
}

/**
 * Combine the user's CLI prompt with stdin and any --file inputs into a
 * single prompt string. File contents are wrapped with a header so the
 * model can see what's what. Returns a token estimate for routing.
 */
export async function assemblePrompt(
  input: AssemblePromptInput,
): Promise<AssembledPrompt> {
  const parts: string[] = [];
  const sources: string[] = [];

  if (input.previousExchange) {
    const { id, prompt, output } = input.previousExchange;
    parts.push(
      `--- previous request ---\n${prompt.trim()}\n\n` +
        `--- previous response ---\n${output.trim()}`,
    );
    sources.push(`resume:${id}`);
  }

  if (input.userPrompt.trim().length > 0) {
    parts.push(input.userPrompt.trim());
    sources.push("argv");
  }

  if (input.stdin && input.stdin.length > 0) {
    parts.push(`--- stdin ---\n${input.stdin.trimEnd()}`);
    sources.push("stdin");
  }

  for (const path of input.files ?? []) {
    const contents = await readFile(path, "utf8");
    parts.push(`--- file: ${path} ---\n${contents.trimEnd()}`);
    sources.push(`file:${path}`);
  }

  const prompt = parts.join("\n\n");
  return {
    prompt,
    contextTokens: estimateTokens(prompt),
    sources,
  };
}
