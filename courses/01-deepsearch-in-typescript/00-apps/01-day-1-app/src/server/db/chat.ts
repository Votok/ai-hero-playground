import { and, eq } from "drizzle-orm";
import { db } from "./index";
import { chats, messages } from "./schema";
import type { Message as AiMessage } from "ai";

// Helper to map AI SDK messages to DB message inserts
const mapMessages = (chatId: string, items: AiMessage[]) => {
  return items.map((m, idx) => ({
    id: (m as any).id ?? crypto.randomUUID(),
    chatId,
    role: m.role,
    parts: (m as any).parts ?? (m as any).content ?? null,
    order: idx,
  }));
};

export const upsertChat = async (opts: {
  userId: string;
  chatId: string;
  title: string;
  messages: AiMessage[];
}) => {
  const { userId, chatId, title, messages: aiMessages } = opts;

  return await db.transaction(async (tx) => {
    // Ensure chat ownership (or absence)
    const existing = await tx
      .select({ id: chats.id, userId: chats.userId })
      .from(chats)
      .where(eq(chats.id, chatId));

    if (existing.length > 0 && existing[0]!.userId !== userId) {
      throw new Error("Chat does not belong to user");
    }

    if (existing.length === 0) {
      await tx.insert(chats).values({ id: chatId, userId, title });
    } else {
      // Update title + updatedAt
      await tx
        .update(chats)
        .set({ title, updatedAt: new Date() })
        .where(and(eq(chats.id, chatId), eq(chats.userId, userId)));
      // Delete existing messages
      await tx.delete(messages).where(eq(messages.chatId, chatId));
    }

    if (aiMessages.length > 0) {
      const rows = mapMessages(chatId, aiMessages);
      await tx.insert(messages).values(rows);
    }

    return { id: chatId };
  });
};

export const getChat = async (opts: { userId: string; chatId: string }) => {
  const { userId, chatId } = opts;
  const rows = await db.query.chats.findFirst({
    where: (c, { eq, and }) => and(eq(c.id, chatId), eq(c.userId, userId)),
    with: {
      messages: {
        orderBy: (m, { asc }) => [asc(m.order)],
      },
    },
  });
  return rows ?? null;
};

export const getChats = async (opts: { userId: string }) => {
  const { userId } = opts;
  const rows = await db.query.chats.findMany({
    where: (c, { eq }) => eq(c.userId, userId),
    columns: { id: true, title: true, createdAt: true, updatedAt: true },
    orderBy: (c, { desc }) => [desc(c.updatedAt), desc(c.createdAt)],
  });
  return rows;
};
