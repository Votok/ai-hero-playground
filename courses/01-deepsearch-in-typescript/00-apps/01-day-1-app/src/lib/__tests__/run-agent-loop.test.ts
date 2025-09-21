import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock Tavily unified search.
vi.mock("~/tavily", () => ({
  tavilySearch: vi.fn(async ({ query }: { query: string }) => ({
    query,
    results: [
      {
        title: "Example Source",
        url: "https://example.com/a",
        content: "Example snippet about topic. Full content for page A.",
        score: 0.9,
      },
      {
        title: "Another Source",
        url: "https://example.org/b",
        content: "Complementary data snippet. Additional details page B.",
        score: 0.88,
      },
    ],
  })),
}));

// Mock the AI model used in getNextAction & answerQuestion. We'll intercept generateObject & generateText.
vi.mock("ai", async (orig) => {
  const actual: any = await orig();
  return {
    ...actual,
    generateObject: async ({ schema, prompt }: any) => {
      // Calls sequence: (1) query planner, (2) action decision, (3) planner again? etc.
      const g: any = globalThis as any;
      if (!g.__plannerCount) g.__plannerCount = 0;
      if (!g.__decisionCount) g.__decisionCount = 0;

      if (prompt.includes("strategic research planner")) {
        g.__plannerCount++;
        return {
          object: {
            plan: "Step 1: Gather baseline info.\nStep 2: Validate specifics.",
            queries: [
              "baseline context topic",
              "recent developments topic",
              "key metrics topic",
            ],
          },
        };
      }
      // Decision prompt path
      g.__decisionCount++;
      if (g.__decisionCount === 1) {
        return {
          object: {
            type: "continue",
            title: "Need more sources",
            reasoning: "First iteration must gather sources.",
          },
        };
      }
      return {
        object: {
          type: "answer",
          title: "Proceed to answer",
          reasoning: "Sufficient coverage from queries.",
        },
      };
    },
    generateText: async ({ system, prompt }: any) => ({
      text: "Final Answer (mocked)",
    }),
  };
});

import { runAgentLoop } from "../run-agent-loop";

// Provide env defaults used in code path if necessary (Vitest may not load .env)
process.env.SEARCH_RESULTS_COUNT = process.env.SEARCH_RESULTS_COUNT || "6";
process.env.TAVILY_API_KEY = process.env.TAVILY_API_KEY || "test-key";

/**
 * Basic smoke test that loop progresses through search->answer sequence
 * with unified automatic scraping inside the search action.
 */
describe("runAgentLoop", () => {
  beforeEach(() => {
    (globalThis as any).__callCount = 0;
  });

  it("produces a final answer string", async () => {
    const stream = await runAgentLoop("What is an example question?");
    await stream.consumeStream();
    const text = await stream.text;
    // Our mocked generateText returns a synthesized answer referencing the question
    expect(text).toContain("example question");
  });
});
