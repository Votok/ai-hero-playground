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

export interface ContinueAction extends BaseActionMeta {
  type: "continue"; // indicates we should gather more info (search phase handled elsewhere)
}

export interface AnswerAction extends BaseActionMeta {
  type: "answer"; // produce final answer now
}
export type Action = ContinueAction | AnswerAction;

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
      .enum(["continue", "answer"])
      .describe(
        `Control decision only.\n- 'continue': Additional information gathering (query planning & searches) should proceed.\n- 'answer': We have sufficient information to compose the final answer.`,
      ),
    title: z
      .string()
      .describe(
        "Concise user-visible title for this control decision (<= 8 words). Examples: 'Need more sources', 'Proceed to answer'.",
      ),
    reasoning: z
      .string()
      .describe(
        "Short reasoning (1-3 sentences) explaining why to continue researching or answer now. Reference coverage, diversity, recency, and remaining gaps.",
      ),
  })
  .describe("Next control action decision object with title + reasoning");

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
    `You are a research loop controller deciding whether to continue gathering information or produce the final answer.\n\n` +
    `You can only choose:\n` +
    `1. continue - More searches should be executed (a separate planner will create queries).\n` +
    `2. answer   - Sufficient coverage & diversity: proceed to synthesize final answer.\n\n` +
    `Decision Guidelines:\n` +
    `- Early steps almost always require 'continue' unless the question is trivially answerable without external sources.\n` +
    `- Choose 'continue' if sources lack diversity (same domains), recency (missing latest year where relevant), or facet coverage (comparisons, risks, alternatives, quantitative data).\n` +
    `- Choose 'answer' only when additional searching is unlikely to materially change or validate the answer.\n` +
    `- Consider user intent, required specificity, and unresolved sub-questions.\n` +
    `- Never hallucinate: if unsure, pick 'continue'.\n\n` +
    `Conversation History (most recent first ~limited):\n${convoHistory || "(none)"}\n\n` +
    (locationBlock ? `Request Location (approx):\n${locationBlock}\n\n` : "") +
    `User Question (latest):\n"${question}"\n\n` +
    `Current Step: ${context.getStep()}\n` +
    `Collected Source History:\n${unifiedHistory || "(none)"}\n\n` +
    `Return ONLY valid JSON with fields: type ('continue'|'answer'), title, reasoning.`
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
  if (!action.title || !action.reasoning) {
    throw new Error("Model failed to supply title or reasoning");
  }
  // Enforce deterministic early exploration: step 0 must be continue.
  if (context.getStep() === 0 && action.type === "answer") {
    return {
      type: "continue",
      title: "Need initial sources",
      reasoning:
        "First step must gather external information before answering.",
    };
  }
  return action;
}
