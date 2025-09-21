import type { Message } from "ai";
import { generateText } from "ai";
import { model } from "~/lib/model";
import { deriveChatTitle } from "~/lib/utils";

// Generates a concise chat title (<= 50 chars) using the LLM. Falls back to deriveChatTitle on error.
export async function generateChatTitle(messages: Message[]): Promise<string> {
  if (!messages || messages.length === 0) return "New Chat";
  try {
    const { text } = await generateText({
      model,
      system: `You are a chat title generator.\nYou will be given a chat history, and you must generate a short title for the chat.\nConstraints:\n- Single concise sentence or noun phrase.\n- Max 50 characters.\n- Capture the essence / main task.\n- Same language as the chat.\n- No quotes, no trailing punctuation unless necessary.`,
      prompt: `Chat history (most recent last):\n\n${messages
        .map((m) => `${m.role.toUpperCase()}: ${(m as any).content}`)
        .join("\n")}\n\nTitle:`,
    });
    const cleaned = text.trim().replace(/^["'\s]+|["'\s]+$/g, "");
    const truncated = cleaned.slice(0, 50).trim();
    return truncated || deriveChatTitle(messages as any[], "New Chat", 50);
  } catch (e) {
    console.error("generateChatTitle failed, falling back", e);
    return deriveChatTitle(messages as any[], "New Chat", 50);
  }
}
