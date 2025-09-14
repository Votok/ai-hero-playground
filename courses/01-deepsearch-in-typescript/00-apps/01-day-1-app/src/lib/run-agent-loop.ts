import { getNextAction } from "~/lib/next-action";
import type { WriteMessageAnnotationFn } from "~/lib/annotations";
import { SystemContext } from "~/lib/system-context";
import type { Message } from "ai";
import { answerQuestion } from "~/lib/answer-question";
import type { StreamTextResult } from "ai";
import { searchSerper } from "~/serper";
import { bulkCrawlWebsites } from "~/server/crawler/crawl";
import { env } from "~/env";

/**
 * Copy of the search tool logic from deep-search.ts turned into a plain function.
 */
async function searchWeb(query: string, abortSignal?: AbortSignal) {
  const results = await searchSerper(
    { q: query, num: env.SEARCH_RESULTS_COUNT },
    abortSignal,
  );
  return results.organic.map((r) => ({
    title: r.title,
    link: r.link,
    snippet: r.snippet,
    date: r.date || null,
  }));
}

/**
 * Copy of the scrapePages tool logic from deep-search.ts turned into a plain function.
 */
async function scrapePages(urls: string[]) {
  return bulkCrawlWebsites({ urls });
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

  const ctx = new SystemContext(question, { priorMessages: prior });
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
      const results = await searchWeb(action.query, options.signal);
      // Map into SystemContext structure
      ctx.reportQueries([
        {
          query: action.query,
          results: results.map((r) => ({
            date: r.date || "unknown",
            title: r.title,
            url: r.link,
            snippet: r.snippet,
          })),
        },
      ]);
    } else if (action.type === "scrape") {
      const crawl = await scrapePages(action.urls);
      // Whether success or partial failure, capture each individual page outcome.
      ctx.reportScrapes(
        crawl.results.map((r) => {
          if (r.result.success) {
            return { url: r.url, result: r.result.data };
          }
          return { url: r.url, result: `(error) ${r.result.error}` };
        }),
      );
    } else if (action.type === "answer") {
      return answerQuestion(ctx, {
        question,
        langfuseTraceId: options.langfuseTraceId,
      });
    }

    ctx.advanceStep();
  }

  // Exceeded steps without explicit answer request.
  return answerQuestion(ctx, {
    question,
    isFinal: true,
    langfuseTraceId: options.langfuseTraceId,
  });
}
