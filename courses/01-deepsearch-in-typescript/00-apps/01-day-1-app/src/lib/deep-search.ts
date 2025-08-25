import { z } from "zod";
import { streamText, type Message, type TelemetrySettings } from "ai";
import { model } from "~/lib/model";
import { searchSerper } from "~/serper";
import { bulkCrawlWebsites } from "~/server/crawler/crawl";

/**
 * Shared system prompt used by deep search chat + evals.
 * Keep this in sync with the API route logic.
 */
function buildSystemPrompt(now: Date = new Date()): string {
  const isoNow = now.toISOString();
  const humanNow =
    now.toLocaleString("en-US", { timeZone: "UTC", hour12: false }) + " UTC";
  return `You are a research assistant. The current date/time is ${humanNow} (ISO: ${isoNow}). When the user asks for anything time-sensitive ("today", "current", "latest", events, prices, weather, sports, news, releases, rankings) you MUST:
- Explicitly reference that the knowledge cutoff of the underlying model may be earlier, but you have real-time search tools.
- Use the provided current date to interpret relative temporal expressions (e.g. "last week", "next month").
- Prefer the most recently dated high-quality sources (verify publication or last updated dates) and cite their dates inline when relevant.

ALWAYS:
1. Run searchWeb for every new user question (unless the user explicitly restricts you to prior chat context only).
2. Immediately AFTER searchWeb, you MUST call scrapePages on a DIVERSE SET of 4-6 high-value URLs (authoritative docs, standards, academic / reputable articles, vendor sources, contrasting viewpoints). Do not skip scrapePages. Diversity means avoid picking multiple pages from the same host unless necessary (at most 2 from one domain).

Detailed Policy:
- Target Count: 4-6 pages per query. Fewer only if absolutely no other relevant distinct domains exist. More than 6 only if user explicitly demands a broad survey.
- Domain Diversity: Prefer distinct domains. If many results are from one domain, include only the single most authoritative deep page plus maybe one complementary page.
- Content Type Diversity: Mix at least two types where possible (e.g., official docs + blog analysis + standard/spec + news/announcement + academic/benchmark).
- Mandatory scrapePages: Even if snippets look sufficient you still fetch full content to reduce hallucination risk.
- Exclusions: Skip obvious duplicates, shallow link farms, SEO spam, and pages with extremely thin content.

Answer Construction Rules (USE DATES WHEN PRESENT):
1. After scraping, synthesize using the FULL PAGE markdown (not raw dumps). Extract only the most relevant sections; do not paste entire pages.
2. Citations: Every factual statement must include an inline markdown citation [Title](URL). If the publication or last updated date is known, append it in parentheses like [Title](URL) (2025-08-24). Never expose a bare URL.
3. Consolidate: If multiple scraped sources agree, cite the strongest one; use others for edge nuances.
4. Structure: Provide a concise direct answer first, then deeper thematic sections (Overview, Key Points, Comparison, Data/Benchmarks, Risks, Recommendations, etc.).
5. Sources Section: Bullet list '- [Title](URL): brief relevance'. Include all scraped sources actually used. If a selected crawl failed but its absence limits completeness, list it with '(crawl failed)'.
6. Formatting: Pure markdown. No HTML. Use fenced code blocks for code or data tables (markdown tables acceptable when helpful).
7. Conversation Exception: Only skip tools for clearly personal/off-topic chit-chat with no external info value; this is rare.
8. Insufficient Coverage: If initial search lacks diversity or depth, perform refined follow-up search queries (e.g., add keywords for alternative tech, criticism, benchmarks) until you can assemble 4-6 diverse high-value pages, then scrape them.

If the user asks for something that is inherently unknowable in real time (future predictions, unreleased data), state the limitation clearly and provide the most recent available dated information instead.

Never fabricate citations or URLs.`;
}

export interface StreamFromDeepSearchOptions {
  messages: Message[];
  onFinish?: Parameters<typeof streamText>[0]["onFinish"]; // optional for reuse in evals where persistence isn't needed
  telemetry: TelemetrySettings;
}

/**
 * Core streaming function used by both the API route and evals.
 * Keeps tools & system prompt in one place.
 */
export function streamFromDeepSearch(opts: StreamFromDeepSearchOptions) {
  return streamText({
    model,
    messages: opts.messages,
    maxSteps: 10,
    system: buildSystemPrompt(),
    tools: {
      searchWeb: {
        parameters: z.object({
          query: z.string().describe("The query to search the web for"),
        }),
        execute: async ({ query }, { abortSignal }) => {
          const results = await searchSerper(
            { q: query, num: 10 },
            abortSignal,
          );
          return results.organic.map((result) => ({
            title: result.title,
            link: result.link,
            snippet: result.snippet,
            date: result.date || null,
          }));
        },
      },
      scrapePages: {
        parameters: z.object({
          urls: z
            .array(z.string().url())
            .min(4)
            .max(6)
            .describe(
              "A diverse set of 4-6 high-value, distinct-domain page URLs to fetch full markdown content for (avoid >2 from same domain)",
            ),
        }),
        execute: async ({ urls }) => {
          const crawlResult = await bulkCrawlWebsites({ urls });
          return crawlResult;
        },
      },
    },
    onFinish: opts.onFinish,
    experimental_telemetry: opts.telemetry,
  });
}

/**
 * Simple ask function for evals: fully consumes the stream and returns final text.
 * No persistence or auth required.
 */
export async function askDeepSearch(messages: Message[]): Promise<string> {
  const result = streamFromDeepSearch({
    messages,
    onFinish: () => {},
    telemetry: { isEnabled: false },
  });
  await result.consumeStream(); // ensure streaming completes
  return await result.text;
}
