import type { Message } from "ai";
import {
  streamText,
  createDataStreamResponse,
  appendResponseMessages,
} from "ai";
import { model } from "~/lib/model";
import { auth } from "~/server/auth";
import { z } from "zod";
import { searchSerper } from "~/serper";
import { bulkCrawlWebsites } from "~/server/crawler/crawl";
import { db } from "~/server/db";
import { userRequests, users, chats } from "~/server/db/schema";
import { and, eq, gte, count } from "drizzle-orm";
import { upsertChat, getChat } from "~/server/db/chat";
import { deriveChatTitle } from "~/lib/utils";
import { Langfuse } from "langfuse";
import { env } from "~/env";

export const maxDuration = 60;

const DAILY_REQUEST_LIMIT = 1;

export async function POST(request: Request) {
  const session = await auth();
  if (!session) {
    return new Response("Unauthorized", { status: 401 });
  }

  const body = (await request.json()) as {
    messages: Array<Message>;
    chatId?: string;
  };
  const { messages, chatId: incomingChatId } = body;

  // Load user (get admin flag)
  const [userRow] = await db
    .select({ id: users.id, isAdmin: users.isAdmin })
    .from(users)
    .where(eq(users.id, session.user.id))
    .limit(1);
  if (!userRow) {
    return new Response("User not found", { status: 404 });
  }

  // Rate limit (skip if admin)
  if (!userRow.isAdmin) {
    const startOfToday = new Date();
    startOfToday.setUTCHours(0, 0, 0, 0);

    const todayCountResult = await db
      .select({ value: count() })
      .from(userRequests)
      .where(
        and(
          eq(userRequests.userId, session.user.id),
          gte(userRequests.createdAt, startOfToday),
        ),
      );
    const todayCount = Number(todayCountResult[0]?.value ?? 0);

    if (todayCount >= DAILY_REQUEST_LIMIT) {
      return new Response("Daily request limit reached", { status: 429 });
    }
  }

  // Record request for analytics (even admin users)
  await db.insert(userRequests).values({ userId: session.user.id });

  // Chat persistence setup
  let chatId = incomingChatId ?? crypto.randomUUID();
  let chatTitle: string | null = null;
  let newChatId: string | null = null; // track if a brand new chat was created

  if (incomingChatId) {
    // Verify chat exists and belongs to user
    const existingMeta = await db
      .select({ id: chats.id, userId: chats.userId, title: chats.title })
      .from(chats)
      .where(eq(chats.id, incomingChatId))
      .limit(1);

    const existingRow = existingMeta[0];
    if (!existingRow) {
      return new Response("Chat not found", { status: 404 });
    }
    if (existingRow.userId !== session.user.id) {
      return new Response("Forbidden", { status: 403 });
    }

    chatTitle = existingRow.title ?? null;
  } else {
    // New chat: derive a title from the first user message (if any)
    chatTitle = deriveChatTitle(messages as any[]);

    // Mark that we are creating a brand new chat now
    newChatId = chatId;

    // Create the chat immediately with only the current (user) messages to guard against stream failures
    try {
      await upsertChat({
        userId: session.user.id,
        chatId,
        title: chatTitle ?? "New Chat",
        messages, // only user / existing messages for now
      });
    } catch (e) {
      console.error("Failed to pre-create chat", e);
      return new Response("Failed to create chat", { status: 500 });
    }
  }

  // Initialize Langfuse client per-request (stateless edge-friendly). Could be optimized to a shared instance if runtime allows.
  const langfuse = new Langfuse({
    environment: env.NODE_ENV,
  });

  // Create trace after final chatId resolved (post creation/validation logic above)
  const trace = langfuse.trace({
    sessionId: chatId, // reuse chat id as session grouping in Langfuse
    name: "chat",
    userId: session.user.id,
  });

  return createDataStreamResponse({
    execute: async (dataStream) => {
      const result = streamText({
        model,
        messages,
        system: `You are a research assistant. ALWAYS:
1. Run searchWeb for every new user question (unless the user explicitly restricts you to prior chat context only).
2. Immediately AFTER searchWeb, you MUST call scrapePages on a DIVERSE SET of 4-6 high-value URLs (authoritative docs, standards, academic / reputable articles, vendor sources, contrasting viewpoints). Do not skip scrapePages. Diversity means avoid picking multiple pages from the same host unless necessary (at most 2 from one domain).

Detailed Policy:
- Target Count: 4-6 pages per query. Fewer only if absolutely no other relevant distinct domains exist. More than 6 only if user explicitly demands a broad survey.
- Domain Diversity: Prefer distinct domains. If many results are from one domain, include only the single most authoritative deep page plus maybe one complementary page.
- Content Type Diversity: Mix at least two types where possible (e.g., official docs + blog analysis + standard/spec + news/announcement + academic/benchmark).
- Mandatory scrapePages: Even if snippets look sufficient you still fetch full content to reduce hallucination risk.
- Exclusions: Skip obvious duplicates, shallow link farms, SEO spam, and pages with extremely thin content.

Answer Construction Rules:
1. After scraping, synthesize using the FULL PAGE markdown (not raw dumps). Extract only the most relevant sections; do not paste entire pages.
2. Citations: Every factual statement must include an inline markdown citation [Title](URL). Never expose a bare URL.
3. Consolidate: If multiple scraped sources agree, cite the strongest one; use others for edge nuances.
4. Structure: Provide a concise direct answer first, then deeper thematic sections (Overview, Key Points, Comparison, Data/Benchmarks, Risks, Recommendations, etc.).
5. Sources Section: Bullet list '- [Title](URL): brief relevance'. Include all scraped sources actually used. If a selected crawl failed but its absence limits completeness, list it with '(crawl failed)'.
6. Formatting: Pure markdown. No HTML. Use fenced code blocks for code or data tables (markdown tables acceptable when helpful).
7. Conversation Exception: Only skip tools for clearly personal/off-topic chit-chat with no external info value; this is rare.
8. Insufficient Coverage: If initial search lacks diversity or depth, perform refined follow-up search queries (e.g., add keywords for alternative tech, criticism, benchmarks) until you can assemble 4-6 diverse high-value pages, then scrape them.

Never fabricate citations or URLs.`,
        tools: {
          searchWeb: {
            parameters: z.object({
              query: z.string().describe("The query to search the web for"),
            }),
            execute: async ({ query }, { abortSignal }) => {
              const results = await searchSerper(
                { q: query, num: 10 },
                abortSignal,
              );
              return results.organic.map((result) => ({
                title: result.title,
                link: result.link,
                snippet: result.snippet,
              }));
            },
          },
          scrapePages: {
            parameters: z.object({
              urls: z
                .array(z.string().url())
                .min(4)
                .max(6)
                .describe(
                  "A diverse set of 4-6 high-value, distinct-domain page URLs to fetch full markdown content for (avoid >2 from same domain)",
                ),
            }),
            execute: async ({ urls }) => {
              const crawlResult = await bulkCrawlWebsites({ urls });
              return crawlResult;
            },
          },
        },
        maxSteps: 10,
        onFinish: async ({ response }) => {
          try {
            const responseMessages = response.messages;
            const updatedMessages = appendResponseMessages({
              messages,
              responseMessages,
            });
            await upsertChat({
              userId: session.user.id,
              chatId,
              title: chatTitle || "Chat",
              messages: updatedMessages,
            });
            // Flush telemetry so trace & spans are exported before request ends
            try {
              await langfuse.flushAsync();
            } catch (e) {
              console.error("Langfuse flush failed", e);
            }
          } catch (e) {
            console.error("Failed to persist completed chat", e);
          }
        },
        experimental_telemetry: {
          isEnabled: true,
          functionId: "agent", // identifier for function/span in Langfuse dashboard
          metadata: {
            langfuseTraceId: trace.id,
          },
        },
      });

      if (newChatId) {
        dataStream.writeData({ type: "NEW_CHAT_CREATED", chatId: newChatId });
      }

      // Remove early exposure of chat id; instead, only emit at end if it's a new chat.
      // result.mergeIntoDataStream will pipe model tokens; afterwards we emit NEW_CHAT_CREATED if applicable.
      result.mergeIntoDataStream(dataStream);
    },
    onError: (e) => {
      console.error(e);
      return "Oops, an error occured!";
    },
  });
}
