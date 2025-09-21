import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

export const env = createEnv({
  /**
   * Specify your server-side environment variables schema here. This way you can ensure the app
   * isn't built with invalid env vars.
   */
  server: {
    REDIS_URL: z.string().url(),
    AUTH_SECRET:
      process.env.NODE_ENV === "production"
        ? z.string()
        : z.string().optional(),
    DATABASE_URL: z.string().url(),
    GOOGLE_GENERATIVE_AI_API_KEY: z.string(),
    AUTH_DISCORD_ID: z.string(),
    AUTH_DISCORD_SECRET: z.string(),
    SERPER_API_KEY: z.string(),
  TAVILY_API_KEY: z.string(),
    // How many search results to request from the search provider for each query.
    // Coerced to number so callers can use it directly.
    SEARCH_RESULTS_COUNT: z.coerce.number().default(6),
    // Minimum number of pages the model must scrape per query (diversity + depth).
    SCRAPE_MIN_PAGES: z.coerce.number().int().min(1).default(4),
    // Maximum number of pages the model should scrape unless user explicitly requests broader survey.
    SCRAPE_MAX_PAGES: z.coerce
      .number()
      .int()
      .min(1)
      .default(6)
      .refine((val) => val >= 4, {
        message:
          "SCRAPE_MAX_PAGES should generally be >= 4 for adequate diversity",
      }),
    LANGFUSE_SECRET_KEY: z.string(),
    LANGFUSE_PUBLIC_KEY: z.string(),
    LANGFUSE_BASEURL: z.string().url(),
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
    // Which evaluation dataset tier to use. Controls how many test cases are loaded in evals.
    EVAL_DATASET: z.enum(["dev", "ci", "regression"]).default("dev"),
  },

  /**
   * Specify your client-side environment variables schema here. This way you can ensure the app
   * isn't built with invalid env vars. To expose them to the client, prefix them with
   * `NEXT_PUBLIC_`.
   */
  client: {},

  /**
   * You can't destruct `process.env` as a regular object in the Next.js edge runtimes (e.g.
   * middlewares) or client-side so we need to destruct manually.
   */
  runtimeEnv: {
    REDIS_URL: process.env.REDIS_URL,
    AUTH_SECRET: process.env.AUTH_SECRET,
    DATABASE_URL: process.env.DATABASE_URL,
    GOOGLE_GENERATIVE_AI_API_KEY: process.env.GOOGLE_GENERATIVE_AI_API_KEY,
    AUTH_DISCORD_ID: process.env.AUTH_DISCORD_ID,
    AUTH_DISCORD_SECRET: process.env.AUTH_DISCORD_SECRET,
    SERPER_API_KEY: process.env.SERPER_API_KEY,
  TAVILY_API_KEY: process.env.TAVILY_API_KEY,
    SEARCH_RESULTS_COUNT: process.env.SEARCH_RESULTS_COUNT,
    SCRAPE_MIN_PAGES: process.env.SCRAPE_MIN_PAGES,
    SCRAPE_MAX_PAGES: process.env.SCRAPE_MAX_PAGES,
    LANGFUSE_SECRET_KEY: process.env.LANGFUSE_SECRET_KEY,
    LANGFUSE_PUBLIC_KEY: process.env.LANGFUSE_PUBLIC_KEY,
    LANGFUSE_BASEURL: process.env.LANGFUSE_BASEURL,
    NODE_ENV: process.env.NODE_ENV,
    EVAL_DATASET: process.env.EVAL_DATASET,
  },
  /**
   * Run `build` or `dev` with `SKIP_ENV_VALIDATION` to skip env validation. This is especially
   * useful for Docker builds.
   */
  skipValidation: !!process.env.SKIP_ENV_VALIDATION,
  /**
   * Makes it so that empty strings are treated as undefined. `SOME_VAR: z.string()` and
   * `SOME_VAR=''` will throw an error.
   */
  emptyStringAsUndefined: true,
});

// Runtime invariant: ensure min <= max (cannot express cross-field constraint directly in current schema easily)
if (env.SCRAPE_MIN_PAGES > env.SCRAPE_MAX_PAGES) {
  throw new Error(
    `Invalid configuration: SCRAPE_MIN_PAGES (${env.SCRAPE_MIN_PAGES}) > SCRAPE_MAX_PAGES (${env.SCRAPE_MAX_PAGES})`,
  );
}
