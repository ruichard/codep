import type { ProviderId } from "../runners/base.js";

/**
 * Task taxonomy. Kept flat and small; router behavior for an unknown type
 * falls back to `general_chat`.
 */
export const TASK_TYPES = [
  "refactor",
  "bugfix",
  "algorithm",
  "scaffold",
  "single_file_gen",
  "sql_regex",
  "review",
  "test_gen",
  "long_context_qa",
  "ui_frontend",
  "multimodal_to_code",
  "ml_datasci",
  "niche_language",
  "docs_comments",
  "general_chat",
] as const;

export type TaskType = (typeof TASK_TYPES)[number];

export function isTaskType(v: string): v is TaskType {
  return (TASK_TYPES as readonly string[]).includes(v);
}

/**
 * Quality matrix: per (task_type, provider) score in [0, 1]. Hand-curated from
 * the plan's coding-profile analysis. models.dev does not provide this.
 *
 * Rationale (see plan.md §二):
 *  - refactor/bugfix/review/test_gen → Claude best (agentic long-horizon edits).
 *  - algorithm/scaffold/sql_regex/ml_datasci/niche_language → GPT best.
 *  - long_context_qa/ui_frontend/multimodal_to_code → Gemini best.
 */
export const QUALITY_MATRIX: Record<TaskType, Record<ProviderId, number>> = {
  refactor:            { claude: 0.95, codex: 0.80, gemini: 0.70 },
  bugfix:              { claude: 0.95, codex: 0.85, gemini: 0.70 },
  review:              { claude: 0.95, codex: 0.80, gemini: 0.70 },
  test_gen:            { claude: 0.90, codex: 0.85, gemini: 0.70 },
  algorithm:           { claude: 0.80, codex: 0.95, gemini: 0.70 },
  scaffold:            { claude: 0.80, codex: 0.90, gemini: 0.75 },
  single_file_gen:     { claude: 0.90, codex: 0.90, gemini: 0.75 },
  sql_regex:           { claude: 0.85, codex: 0.95, gemini: 0.75 },
  ml_datasci:          { claude: 0.80, codex: 0.95, gemini: 0.75 },
  niche_language:      { claude: 0.85, codex: 0.95, gemini: 0.70 },
  long_context_qa:     { claude: 0.80, codex: 0.75, gemini: 0.95 },
  ui_frontend:         { claude: 0.80, codex: 0.80, gemini: 0.90 },
  multimodal_to_code:  { claude: 0.70, codex: 0.80, gemini: 0.95 },
  docs_comments:       { claude: 0.85, codex: 0.85, gemini: 0.85 },
  general_chat:        { claude: 0.85, codex: 0.85, gemini: 0.80 },
};
