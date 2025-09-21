import { streamText, smoothStream, type StreamTextResult } from "ai";
import { model } from "~/lib/model";
import { SystemContext } from "~/lib/system-context";
import { markdownJoinerTransform } from "~/lib/markdown-joiner";

export interface AnswerQuestionOptions {
  /** The original user question we are trying to answer. */
  question: string;
  /** If true, we ran out of allowed steps and must give our best effort with what we have. */
  isFinal?: boolean;
  /** Optional Langfuse trace id for telemetry correlation across loop calls. */
  langfuseTraceId?: string;
  /** Callback when streaming finishes so caller can persist state including annotations. */
  onFinish?: (result: StreamTextResult<{}, string>) => void | Promise<void>;
}

// Build a system prompt containing only role + rules (no variable history)
function buildAnswerSystemPrompt(opts: AnswerQuestionOptions): string {
  const scarcityNote = opts.isFinal
    ? `You have reached the maximum number of reasoning/tool steps. Provide the **best possible answer** with ONLY verified information from the supplied search snippets and scraped content. If unavoidable gaps remain, add a short 'Limitations' section; never hallucinate.`
    : `Proceed to synthesize a high-quality answer strictly grounded in the provided material.`;

  return `You are an expert research synthesis model. Your task is to answer the user's question with high precision, strong structure, and explicit source citations.
${scarcityNote}

Rules:
1. Use ONLY the provided search result snippets & (summarized) page contents. Where a summary is provided, treat it as a faithful condensation of the underlying page; do not assume missing details. If only raw scrape content is present, use it directly.
2. Every factual / quantitative claim must include an inline citation: [Title](URL) or [Title](URL) (YYYY-MM-DD) if a date is available.
3. Consolidate overlapping sources—cite the strongest; add others only for nuance or disagreement.
4. Answer structure:
   - Brief Direct Answer (2–4 sentences)
   - Key Points / Breakdown
   - Deeper Sections (as relevant: Architecture / Comparison / Trade-offs / Benchmarks / Risks / Implementation / Best Practices / Timeline)
   - (Optional) Limitations (only if final AND real gaps remain)
   - Sources (bullet list: - [Title](URL) (YYYY-MM-DD optional): relevance)
5. Pure markdown. No raw HTML. Use code fences only when value-add.
6. Do NOT dump large verbatim passages; extract & paraphrase with citations.
7. Surface conflicting claims explicitly with separate citations.
8. Never fabricate URLs, titles, dates, or unsupported specifics.

Wait for the user prompt that supplies QUESTION, SEARCH HISTORY, and SCRAPED CONTENT.`;
}

/**
 * Generate an answer for the user question using accumulated context.
 * Returns plain markdown text.
 */
export function answerQuestion(
  context: SystemContext,
  opts: AnswerQuestionOptions,
): StreamTextResult<{}, string> {
  const system = buildAnswerSystemPrompt(opts);
  const searchHistory = context.getSearchHistory();
  const convoHistory = context.getConversationHistory();
  const locationBlock = context.getLocationBlock();

  const userPrompt = [
    "CONVERSATION HISTORY (earlier turns):\n" + (convoHistory || "(none)"),
    locationBlock
      ? "REQUEST LOCATION CONTEXT (approx):\n" + locationBlock
      : null,
    "QUESTION (latest user message):\n" + opts.question,
    "SEARCH HISTORY (queries + snippets + scraped content):\n" +
      (searchHistory || "(none)"),
    "Produce the final answer now following the system rules.",
  ]
    .filter(Boolean)
    .join("\n\n");

  const stream = streamText({
    model,
    system,
    prompt: userPrompt,
    temperature: 0.4,
    onFinish: () => {
      if (opts.onFinish) {
        void opts.onFinish(stream);
      }
    },
    ...(opts.langfuseTraceId
      ? {
          experimental_telemetry: {
            isEnabled: true,
            functionId: `agent.answer${opts.isFinal ? ".final" : ""}`,
            metadata: { langfuseTraceId: opts.langfuseTraceId },
          },
        }
      : {}),
    experimental_transform: [
      // First smooth the incoming raw small tokens into line-sized chunks for better UX
      smoothStream({ delayInMs: 120, chunking: "word" }),
      // Then join markdown tokens like **bold** or [links](url) so they appear atomically
      markdownJoinerTransform(),
    ],
  });
  return stream;
}
