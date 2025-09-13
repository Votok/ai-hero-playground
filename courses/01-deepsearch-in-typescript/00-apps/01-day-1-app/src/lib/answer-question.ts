import { generateText } from "ai";
import { model } from "~/lib/model";
import { SystemContext } from "~/lib/system-context";

export interface AnswerQuestionOptions {
  /** The original user question we are trying to answer. */
  question: string;
  /** If true, we ran out of allowed steps and must give our best effort with what we have. */
  isFinal?: boolean;
}

// Build a system prompt containing only role + rules (no variable history)
function buildAnswerSystemPrompt(opts: AnswerQuestionOptions): string {
  const scarcityNote = opts.isFinal
    ? `You have reached the maximum number of reasoning/tool steps. Provide the **best possible answer** with ONLY verified information from the supplied search snippets and scraped content. If unavoidable gaps remain, add a short 'Limitations' section; never hallucinate.`
    : `Proceed to synthesize a high-quality answer strictly grounded in the provided material.`;

  return `You are an expert research synthesis model. Your task is to answer the user's question with high precision, strong structure, and explicit source citations.
${scarcityNote}

Rules:
1. Use ONLY the provided search result snippets & scraped page contents.
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
export async function answerQuestion(
  context: SystemContext,
  opts: AnswerQuestionOptions,
): Promise<string> {
  const system = buildAnswerSystemPrompt(opts);
  const queryHistory = context.getQueryHistory();
  const scrapeHistory = context.getScrapeHistory();

  const userPrompt = [
    "QUESTION:\n" + opts.question,
    "SEARCH HISTORY (queries + snippets):\n" + (queryHistory || "(none)"),
    "SCRAPED PAGE CONTENT:\n" + (scrapeHistory || "(none)"),
    "Produce the final answer now following the system rules.",
  ].join("\n\n");

  const { text } = await generateText({
    model,
    system,
    prompt: userPrompt,
    temperature: 0.4,
  });
  return text;
}
