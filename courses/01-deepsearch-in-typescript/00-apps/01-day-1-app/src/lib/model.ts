import { google } from "@ai-sdk/google";

// Available Google Gemini models:
// - "gemini-2.0-flash-001" (current - supports tool calling)
// - "gemini-1.5-pro"
// - "gemini-1.5-flash"
// - "gemini-1.0-pro"
// Note: Use gemini-2.0-flash-001 or newer for tool calling support

export const model = google("gemini-2.0-flash-001");

// Model used for LLM-as-a-judge (factuality). Using a cheaper, fast model.
export const factualityModel = google("gemini-2.0-flash-001");

// Fast summarization model (larger context, cheaper reasoning). Used for per-URL content condensation.
// We intentionally choose a 'flash-lite' family model prioritizing speed + throughput.
export const summarizationModel = google("gemini-2.0-flash-lite");
