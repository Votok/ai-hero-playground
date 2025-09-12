import { describe, it, expect } from "vitest";

// Keep test minimal due to ESM module caching behavior in Vitest; focus on default.
describe("SEARCH_RESULTS_COUNT env var", () => {
  it("defaults to 10 when unset", async () => {
    delete process.env.SEARCH_RESULTS_COUNT;
    const { env } = await import("../../env.js");
    expect(env.SEARCH_RESULTS_COUNT).toBe(10);
  });
});
