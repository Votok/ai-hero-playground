import { generateText } from "ai";
import { summarizationModel } from "~/lib/model";
import { redis, cacheWithRedis } from "~/server/redis/redis";

export interface SummarizeURLArgs {
  query: string; // the search query that led to this URL
  url: string;
  title: string;
  date?: string;
  snippet: string; // search engine snippet
  content: string; // scraped full content (markdown/plain)
  conversationHistory?: string; // formatted conversation history for extra context
  langfuseTraceId?: string; // for telemetry correlation
}

export interface SummarizeURLResult {
  summary: string; // condensed structured narrative
  tokensApprox?: number; // optional tracking (future)
}

// Prompt adapted from Together.ai summarizer with guardrails for faithfulness.
function buildSummarizationPrompt(args: SummarizeURLArgs): string {
  return `You are a research extraction specialist. Given a research topic (QUESTION), prior conversation (if any), and raw web page content, create a thoroughly detailed synthesis as a cohesive narrative that flows naturally between key concepts.

QUESTION: ${args.query}
PAGE TITLE: ${args.title}
PAGE URL: ${args.url}
PAGE DATE: ${args.date || "unknown"}
SEARCH SNIPPET: ${args.snippet}
${args.conversationHistory ? `CONVERSATION HISTORY (earlier turns):\n${args.conversationHistory}` : ""}

RAW PAGE CONTENT (may contain markdown):\n<content>\n${args.content}\n</content>\n
Extract the most valuable information directly relevant to the QUESTION, including concrete facts, statistics, methodologies, claims, and contextual qualifiers. Preserve technical terminology from the source.

Output Requirements:
- Output ONLY the synthesized narrative paragraphs (no bullet lists) limited to ~350 words.
- Maintain chronological or logical flow; integrate metrics/dates inline with proper context.
- If the content lacks relevant info for part of the QUESTION, explicitly state the absence.
- NEVER fabricate, never rely on outside knowledge beyond this page & snippet.
- Do NOT include sections for content unrelated to the QUESTION.
- Do NOT output a heading; just the narrative paragraphs.
- Use concise paragraphs separated by single blank lines when changing major theme.
`;
}

async function _summarizeURL(
  args: SummarizeURLArgs,
): Promise<SummarizeURLResult> {
  const prompt = buildSummarizationPrompt(args);
  const result = await generateText({
    model: summarizationModel,
    temperature: 0.2,
    maxTokens: 800, // enough for 350 word target
    prompt,
    ...(args.langfuseTraceId
      ? {
          experimental_telemetry: {
            isEnabled: true,
            functionId: "agent.summarize-url",
            metadata: { langfuseTraceId: args.langfuseTraceId, url: args.url },
          },
        }
      : {}),
  });
  return { summary: result.text };
}

// Wrap with redis cache. Key includes version to allow iterative prompt tweaks.
const SUMMARIZE_VERSION = "v1";
export const summarizeURL = cacheWithRedis(
  `summarize:${SUMMARIZE_VERSION}`,
  async (args: SummarizeURLArgs): Promise<SummarizeURLResult> => {
    return _summarizeURL(args);
  },
);
