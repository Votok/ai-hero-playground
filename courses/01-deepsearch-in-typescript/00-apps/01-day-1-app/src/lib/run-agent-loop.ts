import { getNextAction } from "~/lib/next-action";
import type { WriteMessageAnnotationFn } from "~/lib/annotations";
import { SystemContext } from "~/lib/system-context";
import type { Message } from "ai";
import { answerQuestion } from "~/lib/answer-question";
import type { StreamTextResult } from "ai";
// Tavily integration replaces separate search + scrape + summarize passes.
import { env } from "~/env";
import { tavilySearch } from "~/tavily";
import { queryRewriter } from "~/lib/query-rewriter";

// Helper: perform a web search using Tavily which returns already scraped content.
async function searchAndScrape(query: string, abortSignal?: AbortSignal) {
  const results = await tavilySearch({
    query,
    options: { num: env.SEARCH_RESULTS_COUNT },
    signal: abortSignal,
  });

  // Tavily returns `results` each containing title, url, content, score.
  // It may also return an `answer` field, but we treat that as advisory; we still run our own synthesis.
  return results.results.map((r) => ({
    date: "unknown", // Tavily result items currently don't expose dates; could parse from content later
    title: r.title,
    url: r.url,
    snippet:
      r.content.slice(0, 280).replace(/\s+/g, " ") +
      (r.content.length > 280 ? "…" : ""),
    scrapedContent: r.content || "(no content)",
    // No per-page summary yet; future: we could still pass through summarizer if token pressure requires.
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
    // 1. Always produce (or refresh) a plan + queries for this step.
    const qp = await queryRewriter(ctx, {
      langfuseTraceId: options.langfuseTraceId,
    });
    writeAnnotation({
      type: "QUERY_PLAN",
      plan: qp.plan,
      queries: qp.queries,
    });

    // 2. Execute all queries in parallel (search + scrape + summarize) for speed.
    if (qp.queries && qp.queries.length) {
      const searchBatches = await Promise.all(
        qp.queries.map(async (q) => {
          const combined = await searchAndScrape(q, options.signal);
          return { query: q, results: combined } as const;
        }),
      );
      for (const batch of searchBatches) {
        ctx.reportSearch(batch);
      }
    }

    // 3. Decide whether to continue or answer now based on accumulated sources.
    const action = await getNextAction(ctx, {
      langfuseTraceId: options.langfuseTraceId,
    });
    writeAnnotation({ type: "NEW_ACTION", action });

    if (action.type === "answer") {
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
