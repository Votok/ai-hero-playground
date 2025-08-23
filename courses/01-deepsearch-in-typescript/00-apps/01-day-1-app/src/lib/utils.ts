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
