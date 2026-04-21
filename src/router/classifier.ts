import type { TaskType } from "./taxonomy.js";

export interface ClassifyResult {
  taskType: TaskType;
  confidence: number; // 0..1
  /** Human-readable rationale for --explain output. */
  reason: string;
  /** Which classifier produced this. */
  source: "heuristic" | "forced" | "llm";
}

export interface ClassifyInput {
  prompt: string;
  /** If true, caller told us the task involves images. Strong hint toward
   *  multimodal_to_code. */
  hasImage?: boolean;
  /** Estimated tokens — big prompts bias toward long_context_qa. */
  contextTokens?: number;
}

/**
 * Keyword-weighted heuristic classifier. Zero-dep, deterministic, offline.
 * Each task type has a list of (pattern, weight) rules. We pick the
 * highest-scoring type; tie broken by TASK_TYPES order (general_chat last).
 *
 * Confidence is `top / (top + runnerUp + 1)` — so a dominant single match
 * yields ~0.5, while many matches on one type push toward ~0.9.
 */
interface Rule {
  pattern: RegExp;
  weight: number;
}

// Ordered roughly by priority — earlier rules "feel" more specific.
const RULES: Partial<Record<TaskType, Rule[]>> = {
  multimodal_to_code: [
    { pattern: /\b(screenshot|mockup|figma|wireframe|design\s+file)\b/i, weight: 3 },
    { pattern: /\b(this\s+image|the\s+image|from\s+(the\s+)?image|pdf)\b/i, weight: 2 },
    { pattern: /\b(ui\s+from|convert\s+.*\s+to\s+code)\b/i, weight: 2 },
  ],
  ui_frontend: [
    { pattern: /\b(react|vue|svelte|next\.?js|tailwind|css|html|component)\b/i, weight: 2 },
    { pattern: /\b(frontend|front-end|ui|ux|button|form|layout|responsive)\b/i, weight: 1 },
  ],
  sql_regex: [
    { pattern: /\b(sql|query|postgres|mysql|sqlite|select\s+.*\s+from)\b/i, weight: 3 },
    { pattern: /\bregex|regular\s+expression|pattern\s+match/i, weight: 3 },
    { pattern: /\b(join|group\s+by|where|having)\b/i, weight: 1 },
  ],
  algorithm: [
    { pattern: /\b(algorithm|algo|leetcode|competitive)\b/i, weight: 3 },
    { pattern: /\b(dynamic\s+programming|dp|recursion|backtrack|greedy)\b/i, weight: 3 },
    { pattern: /\b(graph|tree|dfs|bfs|dijkstra|complexity|big-?o)\b/i, weight: 2 },
    { pattern: /\b(optimize|performance).{0,40}\b(loop|function|algorithm)\b/i, weight: 2 },
    { pattern: /\b(solve|implement)\b.{0,20}\b(problem|puzzle|challenge)\b/i, weight: 2 },
  ],
  ml_datasci: [
    { pattern: /\b(numpy|pandas|pytorch|tensorflow|sklearn|scikit|jupyter)\b/i, weight: 3 },
    { pattern: /\b(machine\s+learning|ml|neural\s+network|training|dataset)\b/i, weight: 2 },
    { pattern: /\b(dataframe|matrix|tensor|gradient)\b/i, weight: 2 },
  ],
  niche_language: [
    { pattern: /\b(rust|haskell|ocaml|erlang|elixir|clojure|scala|zig|nim)\b/i, weight: 3 },
    { pattern: /\b(cuda|wasm|assembly|verilog|solidity)\b/i, weight: 2 },
  ],
  refactor: [
    { pattern: /\brefactor|clean\s*up|restructure|reorganize|simplify\b/i, weight: 3 },
    { pattern: /\b(extract|rename|split|merge|move)\b.{0,20}\b(function|method|class|module)\b/i, weight: 2 },
    { pattern: /\b(code\s+smell|technical\s+debt|dry|kiss)\b/i, weight: 2 },
  ],
  bugfix: [
    { pattern: /\b(bug|fix|crash|broken|broke|error|exception|stack\s*trace)\b/i, weight: 2 },
    { pattern: /\b(why\s+(is|does|doesn'?t)|not\s+working|failing|fails|panic)\b/i, weight: 2 },
    { pattern: /\b(debug|regression|hotfix|npe|segfault)\b/i, weight: 3 },
  ],
  review: [
    { pattern: /\b(review|audit|lgtm|pr\s+review|code\s+review)\b/i, weight: 3 },
    { pattern: /\b(look\s+at|check|what\s+do\s+you\s+think)\b.{0,30}\b(code|pr|patch|diff)\b/i, weight: 2 },
  ],
  test_gen: [
    { pattern: /\b(write|generate|add)\s+.*\btests?\b/i, weight: 3 },
    { pattern: /\b(unit\s+tests?|integration\s+tests?|vitest|jest|pytest|junit)\b/i, weight: 2 },
    { pattern: /\bcoverage|mocking|fixture\b/i, weight: 1 },
  ],
  scaffold: [
    { pattern: /\b(scaffold|bootstrap|set\s*up|initialize|init)\b.{0,30}\b(project|repo|package|app)\b/i, weight: 3 },
    { pattern: /\b(new\s+(project|app|package|repo|monorepo))\b/i, weight: 2 },
    { pattern: /\b(boilerplate|starter|template)\b/i, weight: 2 },
  ],
  single_file_gen: [
    { pattern: /\b(write|create|generate)\s+a\s+(function|script|snippet|one-?liner)\b/i, weight: 3 },
    { pattern: /\b(one-?off|quick|small)\s+script\b/i, weight: 2 },
  ],
  long_context_qa: [
    { pattern: /\b(whole|entire|across\s+the)\s+(repo|codebase|project|monorepo)\b/i, weight: 3 },
    { pattern: /\b(summari[sz]e|overview|explain)\b.{0,30}\b(repo|codebase|project|files?)\b/i, weight: 3 },
    { pattern: /\b(all\s+files|every\s+file|large\s+codebase)\b/i, weight: 2 },
  ],
  docs_comments: [
    { pattern: /\b(documentation|docs|readme|docstring|jsdoc|tsdoc|javadoc)\b/i, weight: 3 },
    { pattern: /\b(add|write|generate)\s+.*\bcomments?\b/i, weight: 2 },
  ],
};

export function classify(input: ClassifyInput): ClassifyResult {
  const { prompt, hasImage, contextTokens } = input;

  const scores = new Map<TaskType, { score: number; hits: string[] }>();
  const bump = (t: TaskType, w: number, hit: string) => {
    const cur = scores.get(t) ?? { score: 0, hits: [] };
    cur.score += w;
    cur.hits.push(hit);
    scores.set(t, cur);
  };

  for (const [type, rules] of Object.entries(RULES)) {
    for (const r of rules ?? []) {
      const m = prompt.match(r.pattern);
      if (m) bump(type as TaskType, r.weight, m[0]);
    }
  }

  // Structural signals.
  if (hasImage) bump("multimodal_to_code", 5, "--image flag");
  if (contextTokens !== undefined && contextTokens >= 50_000) {
    bump("long_context_qa", 3, `contextTokens≈${contextTokens}`);
  }

  if (scores.size === 0) {
    return {
      taskType: "general_chat",
      confidence: 0.3,
      reason: "no keyword matched; defaulting to general_chat",
      source: "heuristic",
    };
  }

  const ranked = [...scores.entries()].sort((a, b) => b[1].score - a[1].score);
  const [topType, topInfo] = ranked[0]!;
  const runnerUp = ranked[1]?.[1].score ?? 0;
  const confidence = topInfo.score / (topInfo.score + runnerUp + 1);

  const shownHits = topInfo.hits.slice(0, 3).join(", ");
  return {
    taskType: topType,
    confidence: Number(confidence.toFixed(2)),
    reason: `matched: ${shownHits}`,
    source: "heuristic",
  };
}
