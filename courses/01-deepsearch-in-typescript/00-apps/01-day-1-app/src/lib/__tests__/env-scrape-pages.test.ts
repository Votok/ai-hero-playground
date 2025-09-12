import { describe, it, expect } from "vitest";

// Only test defaults; cross-field constraint covered by runtime throw if violated.

describe("SCRAPE_MIN_PAGES / SCRAPE_MAX_PAGES env vars", () => {
  it("defaults to 4 and 6 respectively", async () => {
    delete process.env.SCRAPE_MIN_PAGES;
    delete process.env.SCRAPE_MAX_PAGES;
    const { env } = await import("../../env.js");
    expect(env.SCRAPE_MIN_PAGES).toBe(4);
    expect(env.SCRAPE_MAX_PAGES).toBe(6);
  });
});
