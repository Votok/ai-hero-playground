import { describe, it, expect } from "vitest";
import { summarizeURL } from "~/lib/summarize-url";

// NOTE: This is a light smoke test; in CI this may hit real model unless mocked.
// If env keys are absent, we skip.

describe("summarizeURL", () => {
  const haveKey = !!process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  it.skipIf(!haveKey)("produces a summary for sample content", async () => {
    const res = await summarizeURL({
      query: "What are TypeScript enums?",
      url: "https://example.com/typescript-enums",
      title: "Understanding TypeScript Enums",
      snippet:
        "Guide to using enums in TypeScript including const enums and numeric enums.",
      content: `# Enums in TypeScript\nTypeScript enums allow a developer to define a set of named constants. A numeric enum example...`,
    });
    expect(res.summary.length).toBeGreaterThan(20);
  });
});
