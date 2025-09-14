import { z } from "zod";
import { generateObject } from "ai";
import { model } from "~/lib/model";
import { SystemContext } from "~/lib/system-context";

/**
 * Action type definitions returned by `getNextAction`.
 * NOTE: We purposefully avoid z.union here because JSON Schema `oneOf` often
 * causes LLMs to produce partially merged objects. Instead we use a single
 * discriminant + optional payload fields with explicit conditional guidance.
 */
export interface BaseActionMeta {
  /** Concise user-visible title for this step (e.g. "Searching Rust async runtime history"). */
  title: string;
  /** Short reasoning for why this action was chosen. Can contain brief markdown. */
  reasoning: string;
}

export interface SearchAction extends BaseActionMeta {
  type: "search";
  query: string;
}

export interface ScrapeAction extends BaseActionMeta {
  type: "scrape";
  urls: string[];
}

export interface AnswerAction extends BaseActionMeta {
  type: "answer";
}

export type Action = SearchAction | ScrapeAction | AnswerAction;

/**
 * Zod schema used for structured output parsing.
 * IMPORTANT: We intentionally DO NOT do z.union([...]) because that produces a
 * JSON Schema oneOf which increases invalid blends (e.g. { type: 'scrape', query: '...' }).
 * A single discriminant with optional fields + textual conditional guidance is
 * empirically more reliable for current LLMs.
 */
export const actionSchema = z
  .object({
    type: z
      .enum(["search", "scrape", "answer"])
      .describe(
        `The type of action to take.\n- 'search': Perform a focused web search to gather missing information.\n- 'scrape': Fetch full page content for deeper synthesis (use after identifying promising URLs).\n- 'answer': Provide the final answer to the user (only when confident no further search/scrape materially improves quality).`,
      ),
    title: z
      .string()
      .describe(
        "Concise user-visible title for this step (<= 8 words). Examples: 'Searching HMRC industrial action', 'Scraping framework benchmarks', 'Producing final answer'.",
      ),
    reasoning: z
      .string()
      .describe(
        "Short reasoning (1-3 sentences) explaining why this action is the optimal next step. Reference knowledge gaps or decision criteria. Use markdown lightly if helpful.",
      ),
    query: z
      .string()
      .describe(
        "The query to search for. Required if type is 'search'. Craft it to close specific knowledge gaps (e.g. add qualifiers, alternative tech, dates).",
      )
      .optional(),
    urls: z
      .array(z.string())
      .describe(
        "The URLs to scrape. Required if type is 'scrape'. Should be diverse, authoritative, and non-duplicative (avoid >2 from same domain).",
      )
      .optional(),
  })
  .describe(
    "Next action decision object including title + reasoning for UI transparency",
  );

/**
 * Build a decision-oriented system prompt leveraging existing deep search policy.
 * We summarize rather than repeat full answer synthesis instructions because this
 * function's job is only to decide the NEXT ACTION, not to write the final answer.
 */
function buildDecisionPrompt(context: SystemContext): string {
  const queryHistory = context.getQueryHistory();
  const scrapeHistory = context.getScrapeHistory();
  const question = context.getQuestion();
  const convoHistory = context.getConversationHistory();

  return (
    `You are a research loop controller deciding the SINGLE best next action. You can: \n\n` +
    `1. search  - When new or refined information is needed. Formulate a HIGH-VALUE, Specific, disambiguating query targeting gaps (dates, constraints, comparisons, alternative frameworks, criticisms, benchmarks).\n` +
    `2. scrape  - When you already have candidate URLs (from previous search results) whose FULL content is needed for authoritative synthesis. Choose only high quality, diverse domains (avoid thin/duplicate/spam). If earlier searches exist but you have NOT yet scraped a diverse set, prefer scrape.\n` +
    `3. answer  - Only when you have scraped sufficient diverse, authoritative material to confidently answer with citations and further search/scrape is unlikely to materially improve accuracy.\n\n` +
    `Guidelines:\n` +
    `- Prefer 'search' early (first step almost always search).\n` +
    `- After a search, you almost always need 'scrape' of multiple diverse pages before answering.\n` +
    `- Use follow-up 'search' if existing pages lack diversity (same domain cluster) or miss critical facets (e.g., performance benchmarks, recent updates, critical comparisons, security concerns).\n` +
    `- Do NOT choose 'answer' if there are zero scrapes, or only 1-2 low-diversity scrapes, or unresolved explicit user sub-questions.\n` +
    `- Keep URLs list concise (3-6 typical) for 'scrape' depending on configured limits; avoid already-scraped URLs unless re-scrape is justified (usually not).\n\n` +
    `Conversation History (most recent first ~limited):\n${convoHistory || "(none)"}\n\n` +
    `User Question (latest):\n"${question}"\n\n` +
    `Current Step: ${context.getStep()}\n` +
    `Previous Queries (if any):\n${queryHistory || "(none)"}\n\n` +
    `Previous Scrapes (if any):\n${scrapeHistory || "(none)"}\n\n` +
    `FIRST STEP RULE: If step is 0 you MUST perform a 'search' using a high-quality query derived directly from the user question (do not answer yet and do not scrape before searching).\n\n` +
    `Decide the next action now. Return ONLY the structured JSON object with fields: type, title, reasoning, and conditional fields (query or urls). Do not include any extra commentary outside JSON.`
  );
}

/**
 * Decide the next control action of the deep search loop.
 * Input: current mutable `SystemContext` (read-only usage here) holding prior queries & scrapes.
 * Output: Action object (search | scrape | answer).
 * Error Modes: Throws if model violates required conditional fields.
 */
export async function getNextAction(
  context: SystemContext,
  opts: { langfuseTraceId?: string } = {},
): Promise<Action> {
  const result = await generateObject({
    model,
    schema: actionSchema,
    prompt: buildDecisionPrompt(context),
    temperature: 0.2, // low temperature for determinism in control decisions
    ...(opts.langfuseTraceId
      ? {
          experimental_telemetry: {
            isEnabled: true,
            functionId: `agent.next-action.step-${context.getStep()}`,
            metadata: { langfuseTraceId: opts.langfuseTraceId },
          },
        }
      : {}),
  });

  const action = result.object as Action; // validated by schema

  // Basic post-parse guardrails (defensive programming) enforcing conditional fields.
  if (action.type === "search" && !action.query) {
    throw new Error("Model returned search action without query");
  }
  if (action.type === "scrape" && (!action.urls || action.urls.length === 0)) {
    throw new Error("Model returned scrape action without urls");
  }
  if (!action.title || !action.reasoning) {
    throw new Error("Model failed to supply title or reasoning");
  }
  return action;
}
