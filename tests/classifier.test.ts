import { describe, expect, it } from "vitest";
import { classify } from "../src/router/classifier.js";

describe("classify (heuristic)", () => {
  it("picks refactor for refactor wording", () => {
    const r = classify({ prompt: "Refactor the error handling across the monorepo" });
    expect(r.taskType).toBe("refactor");
    expect(r.source).toBe("heuristic");
  });

  it("picks algorithm for DP wording", () => {
    const r = classify({ prompt: "Solve this dynamic programming problem using memoization" });
    expect(r.taskType).toBe("algorithm");
  });

  it("picks long_context_qa for whole-repo summaries", () => {
    const r = classify({ prompt: "Summarize the entire codebase and explain the architecture" });
    expect(r.taskType).toBe("long_context_qa");
  });

  it("picks sql_regex for SQL wording", () => {
    const r = classify({ prompt: "Write a SQL query to join orders and customers grouped by region" });
    expect(r.taskType).toBe("sql_regex");
  });

  it("picks test_gen for test requests", () => {
    const r = classify({ prompt: "Write unit tests for the auth module using vitest" });
    expect(r.taskType).toBe("test_gen");
  });

  it("picks multimodal_to_code when hasImage is true", () => {
    const r = classify({ prompt: "implement this", hasImage: true });
    expect(r.taskType).toBe("multimodal_to_code");
  });

  it("picks long_context_qa for huge contextTokens", () => {
    const r = classify({ prompt: "do something", contextTokens: 120_000 });
    expect(r.taskType).toBe("long_context_qa");
  });

  it("falls back to general_chat for empty signal", () => {
    const r = classify({ prompt: "hello" });
    expect(r.taskType).toBe("general_chat");
    expect(r.confidence).toBeLessThan(0.5);
  });

  it("picks bugfix for crash wording", () => {
    const r = classify({ prompt: "Why does this crash with a segfault on startup?" });
    expect(r.taskType).toBe("bugfix");
  });

  it("picks ui_frontend for react wording", () => {
    const r = classify({ prompt: "Build a responsive React component with Tailwind" });
    expect(r.taskType).toBe("ui_frontend");
  });
});
