## TODO

Do related followup questions.

Handle anonymous requests to the API, rate limit by IP.

Use a chunking system on the crawled information.

Add 'edit' button, and 'rerun from here' button.

Add evals.

Handle conversations longer than the context window by summarizing.

How do you get the LLM to ask followup questions?

## Setup

1. Install dependencies with `pnpm`

```bash
pnpm install
```

2. Install [Docker Desktop](https://www.docker.com/products/docker-desktop/)

3. Run `./start-database.sh` to start the database.

4. Run `./start-redis.sh` to start the Redis server.

## Environment Variables

This project validates environment variables via `@t3-oss/env-nextjs` in `src/env.js`.

Newly added:

- `SEARCH_RESULTS_COUNT` (number, default: 10) – Controls how many search results are requested from the Serper API per query. Adjust this at runtime (process restart required) to tune breadth vs. cost.
- `SCRAPE_MIN_PAGES` (number, default: 4) – Minimum number of pages the model must scrape after each search to ensure diversity & depth.
- `SCRAPE_MAX_PAGES` (number, default: 6) – Soft ceiling for number of pages to scrape unless the user explicitly asks for a broader survey.

If unset, it defaults to `10`. To override:

```bash
export SEARCH_RESULTS_COUNT=15
export SCRAPE_MIN_PAGES=3
export SCRAPE_MAX_PAGES=5
pnpm dev
```
