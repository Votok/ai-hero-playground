export interface NewChatCreatedEvent {
  type: "NEW_CHAT_CREATED";
  chatId: string;
}

export function isNewChatCreated(data: unknown): data is NewChatCreatedEvent {
  return (
    typeof data === "object" &&
    data !== null &&
    (data as any).type === "NEW_CHAT_CREATED" &&
    typeof (data as any).chatId === "string"
  );
}

// Derive a chat title from the provided messages (prefers most recent user message).
// Safely handles different message content formats produced by AI SDK (string or array of parts).
export function deriveChatTitle(
  messages: Array<{ role?: string; content: any }>,
  fallback: string = "New Chat",
  maxLength: number = 80,
): string {
  if (!Array.isArray(messages) || messages.length === 0) return fallback;
  const firstUserMessage =
    [...messages].reverse().find((m) => m.role === "user") ?? messages[0];
  let rawTitle: string = fallback;
  if (firstUserMessage) {
    const c: any = (firstUserMessage as any).content;
    if (typeof c === "string") rawTitle = c;
    else if (Array.isArray(c)) {
      rawTitle =
        c
          .map((p: any) => {
            if (typeof p === "string") return p;
            if (p && typeof p === "object") {
              if (typeof p.text === "string") return p.text;
              if (typeof p.content === "string") return p.content;
            }
            return "";
          })
          .join(" ")
          .trim() || rawTitle;
    }
  }
  const finalTitle = (rawTitle || fallback).slice(0, maxLength).trim();
  return finalTitle || fallback;
}
