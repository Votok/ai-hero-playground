import { getNextAction } from "~/lib/next-action";
import type { WriteMessageAnnotationFn } from "~/lib/annotations";
import { SystemContext } from "~/lib/system-context";
import type { Message } from "ai";
import { answerQuestion } from "~/lib/answer-question";
import type { StreamTextResult } from "ai";
import { searchSerper } from "~/serper";
import { bulkCrawlWebsites } from "~/server/crawler/crawl";
import { env } from "~/env";
import { summarizeURL } from "~/lib/summarize-url";

// Helper: perform a web search (serper) and immediately crawl each resulting URL.
async function searchAndScrape(query: string, abortSignal?: AbortSignal) {
  const results = await searchSerper(
    { q: query, num: env.SEARCH_RESULTS_COUNT },
    abortSignal,
  );
  const organic = results.organic.map((r) => ({
    title: r.title,
    link: r.link,
    snippet: r.snippet,
    date: r.date || "unknown",
  }));

  // Crawl all URLs (best-effort). We rely on redis caching inside crawler for reuse.
  const crawl = await bulkCrawlWebsites({ urls: organic.map((o) => o.link) });
  const crawlMap = new Map(
    crawl.results.map((r) => [r.url, r.result] as const),
  );

  // Build base result objects first (with raw scraped content / errors)
  const baseResults = organic.map((o) => {
    const page = crawlMap.get(o.link);
    if (page && page.success) {
      return {
        date: o.date,
        title: o.title,
        url: o.link,
        snippet: o.snippet,
        scrapedContent: page.data,
      };
    }
    return {
      date: o.date,
      title: o.title,
      url: o.link,
      snippet: o.snippet,
      scrapedContent:
        page && !page.success ? `(error) ${page.error}` : "(no content)",
    };
  });

  // Summarize only successful pages with real content (skip errors/no content)
  const summaries = await Promise.all(
    baseResults.map(async (r) => {
      if (!r.scrapedContent || r.scrapedContent.startsWith("(error)"))
        return null;
      if (r.scrapedContent === "(no content)") return null;
      try {
        const res = await summarizeURL({
          query,
          url: r.url,
          title: r.title,
          // date might be 'unknown'
          date: r.date,
          snippet: r.snippet,
          content: r.scrapedContent,
        });
        return res.summary;
      } catch (e) {
        console.error("summarizeURL failed", r.url, e);
        return null;
      }
    }),
  );

  return baseResults.map((r, i) => ({
    ...r,
    summary: summaries[i] || undefined,
  }));
}

export interface RunAgentLoopOptions {
  /** Maximum reasoning/tool steps (default mirrors SystemContext heuristic). */
  maxSteps?: number;
  /** Optional AbortSignal for early cancellation. */
  signal?: AbortSignal;
  /** Function to emit UI annotations about internal actions (no-op in evals). */
  writeMessageAnnotation?: WriteMessageAnnotationFn;
  /** Optional Langfuse trace id to wire into all LLM calls for observability. */
  langfuseTraceId?: string;
  /** Full chat message history including the latest user question. */
  messages?: Message[];
  /** onFinish callback for final answer streaming */
  onFinish?: (result: StreamTextResult<{}, string>) => void | Promise<void>;
  /** Optional location hints */
  location?: {
    latitude?: string;
    longitude?: string;
    city?: string;
    country?: string;
  };
}

/**
 * Orchestrates the iterative research loop until an answer is produced or we exhaust steps.
 */
export async function runAgentLoop(
  question: string,
  options: RunAgentLoopOptions = {},
): Promise<StreamTextResult<{}, string>> {
  // Derive prior messages excluding the last user question (already provided as question)
  let prior: { role: string; content: string }[] = [];
  if (options.messages && options.messages.length) {
    // Filter out system/tool/assistant messages to keep focused context (we keep assistant + user though for coherence)
    // We'll include everything except we skip the final user message since it's "question"
    const lastUserIndex = [...options.messages]
      .reverse()
      .find((m) => m.role === "user");
    const lastUserContent = (lastUserIndex as any)?.content?.toString?.();
    prior = options.messages
      .filter((m) => m.role === "user" || m.role === "assistant")
      .filter((m) => m.content?.toString() !== lastUserContent)
      .map((m) => ({ role: m.role, content: m.content.toString() }));
  }

  const ctx = new SystemContext(question, {
    priorMessages: prior,
    location: options.location,
  });
  const maxSteps = options.maxSteps ?? 10;
  const writeAnnotation: WriteMessageAnnotationFn =
    options.writeMessageAnnotation ?? (() => {});

  while (ctx.getStep() < maxSteps) {
    const action = await getNextAction(ctx, {
      langfuseTraceId: options.langfuseTraceId,
    });

    // Emit annotation so UI can render step trace
    writeAnnotation({ type: "NEW_ACTION", action });

    if (action.type === "search") {
      const combined = await searchAndScrape(action.query, options.signal);
      ctx.reportSearch({
        query: action.query,
        results: combined,
      });
    } else if (action.type === "answer") {
      return answerQuestion(ctx, {
        question,
        langfuseTraceId: options.langfuseTraceId,
        onFinish: options.onFinish,
      });
    }

    ctx.advanceStep();
  }

  // Exceeded steps without explicit answer request.
  return answerQuestion(ctx, {
    question,
    isFinal: true,
    langfuseTraceId: options.langfuseTraceId,
    onFinish: options.onFinish,
  });
}
