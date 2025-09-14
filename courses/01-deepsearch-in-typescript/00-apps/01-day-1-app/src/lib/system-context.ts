// SystemContext: tracks iterative deep search loop state.
// This will be passed into `getNextAction` (to be implemented later).

export type QueryResultSearchResult = {
  date: string; // e.g. ISO timestamp or human readable date
  title: string;
  url: string;
  snippet: string; // short extract/summary from search result
};

export type QueryResult = {
  query: string;
  results: QueryResultSearchResult[];
};

export type ScrapeResult = {
  url: string;
  result: string; // raw scraped content (may be markdown / HTML → converted)
};

/**
 * Convert an individual search result into a concise, LLM-friendly markdown block.
 */
const toQueryResult = (r: QueryResultSearchResult): string =>
  [`### ${r.date} - ${r.title}`, r.url, r.snippet].join("\n\n");

/**
 * Container for maintaining loop state across search + scrape iterations.
 * Keeps internal arrays private and exposes read-only, LLM-optimized views.
 */
export class SystemContext {
  /** Original user question driving the loop */
  private question: string;
  /** The current step in the loop */
  private step = 0;

  /** The history of all queries searched */
  private queryHistory: QueryResult[] = [];

  /** The history of all URLs scraped */
  private scrapeHistory: ScrapeResult[] = [];

  /** Prior conversation messages (excluding the latest user question already in question) */
  private priorMessages: { role: string; content: string }[] = [];

  constructor(
    question: string,
    opts?: { priorMessages?: { role: string; content: string }[] },
  ) {
    this.question = question;
    if (opts?.priorMessages?.length) {
      // Shallow copy & trim excessively long histories (keep last 12 to stay concise)
      const MAX_HISTORY = 12;
      this.priorMessages = opts.priorMessages.slice(-MAX_HISTORY);
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

  /** Report the results of executed queries. */
  reportQueries(queries: QueryResult[]): void {
    if (queries.length === 0) return;
    this.queryHistory.push(...queries);
  }

  /** Report the results of completed scrapes. */
  reportScrapes(scrapes: ScrapeResult[]): void {
    if (scrapes.length === 0) return;
    this.scrapeHistory.push(...scrapes);
  }

  /** LLM-formatted history of all queries + their results. */
  getQueryHistory(): string {
    if (this.queryHistory.length === 0) return "";
    return this.queryHistory
      .map((q) =>
        [`## Query: "${q.query}"`, ...q.results.map(toQueryResult)].join(
          "\n\n",
        ),
      )
      .join("\n\n");
  }

  /** LLM-formatted history of all scrapes. */
  getScrapeHistory(): string {
    if (this.scrapeHistory.length === 0) return "";
    return this.scrapeHistory
      .map((s) =>
        [
          `## Scrape: "${s.url}"`,
          `<scrape_result>`,
          s.result,
          `</scrape_result>`,
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
}
