import { describe, it, expect, vi, beforeEach } from "vitest";

// We mock searchSerper, bulkCrawlWebsites, and model generateObject/generateText for determinism under new unified search+scrape flow.
vi.mock("~/serper", () => ({
  searchSerper: vi.fn(async () => ({
    organic: [
      {
        title: "Example Source",
        link: "https://example.com/a",
        snippet: "Example snippet about topic",
        position: 1,
        date: "2025-08-01",
      },
      {
        title: "Another Source",
        link: "https://example.org/b",
        snippet: "Complementary data snippet",
        position: 2,
        date: "2025-08-02",
      },
    ],
  })),
}));

vi.mock("~/server/crawler/crawl", () => ({
  bulkCrawlWebsites: vi.fn(async ({ urls }: { urls: string[] }) => ({
    success: true,
    results: urls.map((u) => ({
      url: u,
      result: {
        success: true as const,
        data: `# Title for ${u}\n\nContent for ${u}`,
      },
    })),
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
