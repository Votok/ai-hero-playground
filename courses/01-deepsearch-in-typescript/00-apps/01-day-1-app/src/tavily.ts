import { tavily } from "@tavily/core";
import { cacheWithRedis } from "~/server/redis/redis";

if (!process.env.TAVILY_API_KEY) {
  // Fail fast during build/start if key missing (env validation should also catch)
  throw new Error("TAVILY_API_KEY env var is required");
}

const tvly = tavily({ apiKey: process.env.TAVILY_API_KEY });

export interface TavilySearchOptions {
  num: number; // number of results to retrieve
}

export interface TavilyResultItem {
  title: string;
  url: string;
  content: string; // Tavily returns already scraped/cleaned content
  score?: number;
}

export interface TavilySearchResponse {
  query: string;
  answer?: string;
  results: TavilyResultItem[];
  response_time?: string;
}

// Wrap with redis caching to avoid duplicate external calls for identical queries/num
export const tavilySearch = cacheWithRedis(
  "tavilySearch",
  async (
    input: { query: string; options: TavilySearchOptions } & {
      signal?: AbortSignal | undefined;
    },
  ): Promise<TavilySearchResponse> => {
    const { query, options, signal } = input;
    // tvly.search signature: (query:string, opts?: { num?: number })
    const res = await tvly.search(query, { num: options.num, signal } as any);
    return res as TavilySearchResponse;
  },
);
