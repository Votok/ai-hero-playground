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

export interface AnswerAction extends BaseActionMeta {
  type: "answer";
}
export type Action = SearchAction | AnswerAction;

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
      .enum(["search", "answer"])
      .describe(
        `The type of action to take.\n- 'search': Perform a focused web search to gather missing information (the system will automatically retrieve & scrape top results).\n- 'answer': Provide the final answer to the user (only when further searching is unlikely to materially improve accuracy).`,
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
    // Legacy field removed: urls (scraping now automatic after each search)
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
  const unifiedHistory = context.getSearchHistory();
  const question = context.getQuestion();
  const convoHistory = context.getConversationHistory();
  const locationBlock = context.getLocationBlock();

  return (
    `You are a research loop controller deciding the SINGLE best next action. You can only:\n\n` +
    `1. search  - When new or refined information is needed. Formulate a HIGH-VALUE, specific, disambiguating query targeting gaps (dates, constraints, comparisons, alternative tech/frameworks, criticisms, benchmarks). The system will automatically retrieve & scrape the top results (limited count) for you.\n` +
    `2. answer  - Only when accumulated scraped material is sufficiently diverse, authoritative, and comprehensive that further searching is unlikely to materially improve accuracy.\n\n` +
    `Guidelines:\n` +
    `- First step MUST be 'search'.\n` +
    `- Perform follow-up 'search' if current material lacks domain diversity (too many from same host), temporal coverage (missing recent updates), or facet coverage (benchmarks, risks, alternatives, criticisms).\n` +
    `- Do NOT choose 'answer' if there are glaring gaps, narrow sourcing, or unresolved explicit sub-questions from the user.\n` +
    `- Keep queries tightly scoped to close knowledge gaps—not broad generic queries.\n\n` +
    `Conversation History (most recent first ~limited):\n${convoHistory || "(none)"}\n\n` +
    (locationBlock ? `Request Location (approx):\n${locationBlock}\n\n` : "") +
    `User Question (latest):\n"${question}"\n\n` +
    `Current Step: ${context.getStep()}\n` +
    `Search & Scrape History (combined):\n${unifiedHistory || "(none)"}\n\n` +
    `FIRST STEP RULE: If step is 0 you MUST perform a 'search' using a high-quality query derived directly from the user question (do not answer yet).\n\n` +
    `Return ONLY valid JSON with fields: type, title, reasoning, and conditional field (query for search). No extra commentary.`
  );
}

/**
 * Decide the next control action of the deep search loop.
 * Input: current mutable `SystemContext` (read-only usage here) holding prior unified search history.
 * Output: Action object (search | answer).
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
  if (!action.title || !action.reasoning) {
    throw new Error("Model failed to supply title or reasoning");
  }
  return action;
}
