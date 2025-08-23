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
import { db } from "~/server/db";
import { userRequests, users, chats } from "~/server/db/schema";
import { and, eq, gte, count } from "drizzle-orm";
import { upsertChat, getChat } from "~/server/db/chat";
import { deriveChatTitle } from "~/lib/utils";

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

  return createDataStreamResponse({
    execute: async (dataStream) => {
      const result = streamText({
        model,
        messages,
        system: `You are a research assistant. ALWAYS attempt to use the searchWeb tool before answering a new user question to obtain current, reliable information.

Instructions:
1. Tool Use: If you have not yet searched for the current question, call searchWeb first.
2. Citations: Every factual statement must be followed by an inline markdown citation using the exact format [Title](URL). Never expose a raw bare URL (e.g. https://example.com) without markdown.
3. Source Consolidation: If multiple sources confirm the same fact, cite only the strongest / most authoritative one.
4. Snippets: Integrate and synthesize—do not just list snippets. Provide a clear, concise answer first, then elaborate.
5. Sources Section: After the main answer, include a heading 'Sources' followed by a bullet list where every item is '- [Title](URL): brief relevance'. Only include sources you actually used.
6. Formatting: Use markdown. No HTML. Do not hallucinate URLs or titles—use exactly those returned by searchWeb. If a title is too long, you may shorten it while keeping meaning.
7. If the user asks casual or personal questions with no need for external info, you may answer directly, but this should be rare; still consider whether a quick search could add value.

If you lack sufficient information after one search, perform a refined follow-up search (new query) before answering.`,
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
          } catch (e) {
            console.error("Failed to persist completed chat", e);
          }
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
