import type { Message } from "ai";
import { createDataStreamResponse } from "ai";
import { auth } from "~/server/auth";
import { db } from "~/server/db";
import { userRequests, users, chats } from "~/server/db/schema";
import { and, eq, gte, count } from "drizzle-orm";
import { upsertChat } from "~/server/db/chat";
import { deriveChatTitle } from "~/lib/utils";
import { streamFromDeepSearch } from "~/lib/deep-search";
import type { OurMessageAnnotation } from "~/lib/annotations";
import { Langfuse } from "langfuse";
import { env } from "~/env";
import { checkRateLimit, recordRateLimit } from "~/server/redis/rate-limit";

export const maxDuration = 60;

const DAILY_REQUEST_LIMIT = 1;

export async function POST(request: Request) {
  // Global LLM usage rate limit (test configuration: 1 request / 5 seconds)
  const globalRateLimitConfig = {
    maxRequests: 1,
    windowMs: 5_000,
    keyPrefix: "global_llm", // shared across all users
    maxRetries: 3,
  } as const;

  // Non-destructive check first; if not allowed attempt retries (waiting for window reset)
  const globalCheck = await checkRateLimit(globalRateLimitConfig);
  if (!globalCheck.allowed) {
    console.error("Global rate limit exceeded, waiting...");
    const allowedAfterWait = await globalCheck.retry();
    if (!allowedAfterWait) {
      return new Response("Rate limit exceeded", { status: 429 });
    }
  }
  // Record usage (increments counter for this window)
  await recordRateLimit(globalRateLimitConfig);

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

  // Initialize Langfuse client per-request (stateless edge-friendly)
  const langfuse = new Langfuse({
    environment: env.NODE_ENV,
  });

  // Create trace after final chatId resolved
  const trace = langfuse.trace({
    sessionId: chatId,
    name: "chat",
    userId: session.user.id,
  });

  return createDataStreamResponse({
    execute: async (dataStream) => {
      const result = await streamFromDeepSearch({
        messages,
        onFinish: async ({ response }) => {
          try {
            const responseMessages = response.messages.filter(
              (m) => m.role === "assistant",
            ) as Message[];
            const updatedMessages = [...messages, ...responseMessages];
            await upsertChat({
              userId: session.user.id,
              chatId,
              title: chatTitle || "Chat",
              messages: updatedMessages,
            });
            try {
              await langfuse.flushAsync();
            } catch (e) {
              console.error("Langfuse flush failed", e);
            }
          } catch (e) {
            console.error("Failed to persist completed chat", e);
          }
        },
        telemetry: {
          isEnabled: true,
          functionId: "agent",
          metadata: { langfuseTraceId: trace.id },
        },
        writeMessageAnnotation: (annotation: OurMessageAnnotation) => {
          // Ensure the annotation is JSON serializable (strip prototypes / methods if any)
          const jsonAnnotation: OurMessageAnnotation = {
            type: annotation.type,
            action: { ...annotation.action },
          } as any;
          dataStream.writeMessageAnnotation(jsonAnnotation as any);
        },
      });

      if (newChatId) {
        dataStream.writeData({ type: "NEW_CHAT_CREATED", chatId: newChatId });
      }

      result.mergeIntoDataStream(dataStream);
    },
    onError: (e) => {
      console.error(e);
      return "Oops, an error occured!";
    },
  });
}
