import { z } from "zod";
import { generateObject } from "ai";
import { model } from "~/lib/model";
import { SystemContext } from "~/lib/system-context";

export const queryPlanSchema = z
  .object({
    plan: z
      .string()
      .min(40, {
        message:
          "Provide a meaningful multi-sentence research plan (>=40 characters).",
      })
      .describe(
        "A concise but detailed multi-paragraph research plan (markdown allowed) explaining the logical sequence of information gathering steps.",
      ),
    queries: z
      .array(
        z
          .string()
          .describe(
            "One focused natural language search query (no boolean operators) that advances the plan.",
          ),
      )
      .min(0)
      .max(6)
      .describe(
        "0-6 sequential queries. Return empty array ONLY if absolutely no further external info is required.",
      ),
  })
  .describe(
    "Research plan plus sequential search queries. Can legitimately return an empty queries array when sufficient sources already exist.",
  );

function buildPlannerPrompt(context: SystemContext): string {
  const question = context.getQuestion();
  const prior = context.getSearchHistory();
  return (
    `You are a strategic research planner with expertise in breaking down complex questions into logical search steps.\n\n` +
    `Question to answer:\n"${question}"\n\n` +
    (prior
      ? `Existing gathered sources (for awareness – avoid redundant queries):\n${prior}\n\n`
      : `No sources gathered yet. This is the initial planning step.\n\n`) +
    `Your tasks:\n` +
    `1. Analyze the question: identify components, implicit assumptions, required context, ambiguous terms.\n` +
    `2. Draft a strategic research plan that sequences information needs from broad context to specific verification.\n` +
    `3. Output 3-5 sequential, tightly-focused natural language search queries (no AND/OR, no quotes unless critical).\n\n` +
    `Guidelines for queries:\n` +
    `- Progress logically (foundational -> comparative/critical -> specific/validation).\n` +
    `- Each query should have a distinct purpose (definition, timeline, quantitative data, risks, alternatives, benchmarks, geography, recency).\n` +
    `- Avoid redundancy with already collected sources.\n` +
    `- Prefer specificity over generic breadth. Include temporal or geographic qualifiers only if relevant.\n` +
    `- If initial step, first query may be exploratory to establish baseline context.\n\n` +
    `STRICT STYLE RULES:\n` +
    `- Queries must NOT start with meta phrases like 'Need to', 'Confirm', 'Check', 'Determine', 'Find out', 'Verify'.\n` +
    `- No imperative / meta commentary. Use direct topical phrasing (e.g. 'rust async runtime evolution 2024').\n` +
    `- No first-person language.\n` +
    `- Keep each query under 110 characters.\n\n` +
    `Return ONLY JSON with fields: plan (markdown ok) and queries (array).`
  );
}

export async function queryRewriter(
  context: SystemContext,
  opts: { langfuseTraceId?: string } = {},
) {
  const res = await generateObject({
    model,
    schema: queryPlanSchema,
    temperature: 0.4, // a bit more creative for planning
    prompt: buildPlannerPrompt(context),
    ...(opts.langfuseTraceId
      ? {
          experimental_telemetry: {
            isEnabled: true,
            functionId: `agent.query-planner.step-${context.getStep()}`,
            metadata: { langfuseTraceId: opts.langfuseTraceId },
          },
        }
      : {}),
  });

  let obj = res.object as z.infer<typeof queryPlanSchema>;

  // Fallback / augmentation logic:
  const question = context.getQuestion();
  // 1. Defensive fallback plan (should rarely trigger because of schema validation) but ensures UI never empty.
  if (!obj.plan || obj.plan.trim().length < 25) {
    obj.plan = [
      `**Research Strategy**`,
      `1. Break down the question: clarify scope, key entities, implicit assumptions, timeframe, ambiguous terms.`,
      `2. Gather foundational context (definitions, baseline state, core mechanisms).`,
      `3. Collect recent developments (last 12–24 months) and authoritative quantitative or benchmark data where applicable.`,
      `4. Explore comparative viewpoints (alternatives, trade-offs, risks, limitations).`,
      `5. Cross-validate critical claims using at least two independent reputable sources before synthesizing answer.`,
    ].join("\n");
  }

  // 2. Clean queries for meta prefixes & enforce constraints.
  const META_PREFIX =
    /^(need to|need|confirm|check|determine|find out|figure out|verify)\s+/i;
  if (Array.isArray(obj.queries)) {
    obj.queries = obj.queries
      .map((q) => q.trim())
      .filter(Boolean)
      .map((q) => q.replace(META_PREFIX, ""))
      .map((q) => (q.length > 110 ? q.slice(0, 108).trimEnd() : q));
  } else {
    obj.queries = [];
  }

  // Step 0 must yield initial exploration queries; if model returned too few, synthesize.
  if (context.getStep() === 0) {
    if (!obj.queries) obj.queries = [];
    // Ensure at least 3 baseline queries early.
    if (obj.queries.length < 3) {
      const seed = question.length > 140 ? question.slice(0, 140) : question;
      const additions: string[] = [];
      additions.push(seed.trim());
      additions.push(`background and key concepts about ${seed.trim()}`);
      additions.push(`recent developments and updates about ${seed.trim()}`);
      // Deduplicate / merge
      const merged = [...obj.queries, ...additions]
        .map((q) => q.trim())
        .filter(Boolean)
        .map((q) => q.replace(META_PREFIX, ""));
      const unique: string[] = [];
      for (const q of merged) {
        if (!unique.some((u) => u.toLowerCase() === q.toLowerCase()))
          unique.push(q);
      }
      obj.queries = unique.slice(0, 4); // cap to 4 to control cost
    }
  }

  // If model returned more than 0 queries despite indicating sufficiency, keep them.
  // If queries empty and we are not at step 0, that's fine—loop will just move to action decision.

  return obj;
}

export type QueryPlan = z.infer<typeof queryPlanSchema>;
