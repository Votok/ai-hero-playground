// SystemContext: tracks iterative deep search loop state.
// Refactored to maintain a single unified search history where each entry
// contains both the search result snippet metadata AND the scraped page content.

export type SearchResult = {
  date: string; // ISO or human readable date
  title: string;
  url: string;
  snippet: string; // snippet from search provider
  scrapedContent: string; // full (processed) page content (markdown) or error marker
  summary?: string; // condensed summary produced by summarizer (optional)
};

export type SearchHistoryEntry = {
  query: string;
  results: SearchResult[];
};

/**
 * Convert an individual unified search result (with scraped content) into an
 * LLM-friendly markdown block.
 */
const toUnifiedResult = (r: SearchResult): string => {
  // Prefer summary if present to reduce context size; include tiny marker that full content was summarized.
  if (r.summary) {
    return [
      `### ${r.date} - ${r.title}`,
      r.url,
      r.snippet,
      `<summary_result>`,
      r.summary,
      `</summary_result>`,
      `<!-- summarized -->`,
    ].join("\n\n");
  }
  return [
    `### ${r.date} - ${r.title}`,
    r.url,
    r.snippet,
    `<scrape_result>`,
    r.scrapedContent,
    `</scrape_result>`,
  ].join("\n\n");
};

/**
 * Container for maintaining loop state across search + scrape iterations.
 * Keeps internal arrays private and exposes read-only, LLM-optimized views.
 */
export class SystemContext {
  /** Original user question driving the loop */
  private question: string;
  /** The current step in the loop */
  private step = 0;

  /** Unified history of searches with their associated scraped results */
  private searchHistory: SearchHistoryEntry[] = [];

  /** Prior conversation messages (excluding the latest user question already in question) */
  private priorMessages: { role: string; content: string }[] = [];

  /** Optional approximate request location */
  private location?: {
    latitude?: string;
    longitude?: string;
    city?: string;
    country?: string;
  };

  constructor(
    question: string,
    opts?: {
      priorMessages?: { role: string; content: string }[];
      location?: {
        latitude?: string;
        longitude?: string;
        city?: string;
        country?: string;
      };
    },
  ) {
    this.question = question;
    if (opts?.priorMessages?.length) {
      // Shallow copy & trim excessively long histories (keep last 12 to stay concise)
      const MAX_HISTORY = 12;
      this.priorMessages = opts.priorMessages.slice(-MAX_HISTORY);
    }
    if (opts?.location) {
      this.location = { ...opts.location };
    }
  }

  /** Get original user question */
  getQuestion(): string {
    return this.question;
  }

  /** Increment the internal step counter (invoked externally by loop driver). */
  advanceStep(): void {
    this.step += 1;
  }

  /** Get current step number (read-only). */
  getStep(): number {
    return this.step;
  }

  /** Whether the loop should stop. Basic heuristic for now. */
  shouldStop(): boolean {
    return this.step >= 10; // placeholder stopping condition
  }

  /** Report a completed search (including scraped page contents). */
  reportSearch(entry: SearchHistoryEntry): void {
    if (!entry || !entry.results?.length) return;
    this.searchHistory.push(entry);
  }

  /** LLM-formatted unified history of all searches + snippets + scraped contents. */
  getSearchHistory(): string {
    if (this.searchHistory.length === 0) return "";
    return this.searchHistory
      .map((search) =>
        [
          `## Query: "${search.query}"`,
          ...search.results.map(toUnifiedResult),
        ].join("\n\n"),
      )
      .join("\n\n");
  }

  /** Formatted prior conversation history for LLM consumption (may be empty). */
  getConversationHistory(): string {
    if (!this.priorMessages.length) return "";
    return this.priorMessages
      .map((m, i) => `### ${i + 1}. ${m.role.toUpperCase()}\n${m.content}`)
      .join("\n\n");
  }

  /** Formatted location block for prompts (may be empty). */
  getLocationBlock(): string {
    if (!this.location) return "";
    const { city, country, latitude, longitude } = this.location;
    if (!city && !country && !latitude && !longitude) return "";
    return [
      `USER LOCATION (approx from IP geolocation)`,
      `city: ${city || "unknown"}`,
      `country: ${country || "unknown"}`,
      `latitude: ${latitude || "unknown"}`,
      `longitude: ${longitude || "unknown"}`,
      `Use this when interpreting relative phrases like "near me", "nearby", "local", unless user specifies a different location explicitly. If user gives another place, prefer the explicit user-provided location.`,
    ].join("\n");
  }
}
