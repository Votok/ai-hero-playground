import { evalite } from "evalite";
import { askDeepSearch } from "~/lib/deep-search";
import type { Message } from "ai";
import { Factuality } from "./factuality-scorer";

evalite("Deep Search Eval", {
  data: async (): Promise<{ input: string; expected: string }[]> => {
    return [
      {
        input: "What is the capital of France?",
        expected: "The capital of France is Paris.",
      },
      {
        input: "What is the largest mammal?",
        expected: "The largest mammal is the blue whale.",
      },
      {
        input: "Who developed and when was ngrx signal store released?",
        expected: `Manfred Steyer, July 2024`,
      },
      {
        input:
          "When will the elections take place in Czechia in 2025? If Pirate Party will win, who will be the PM? If they are able to form a coalition, which parties will be part of it and how this would compare to last elections?",
        expected:
          "The elections in Czechia are scheduled for October 2025. If the Pirate Party wins, the PM will be Ivan Bartoš.",
      },
      {
        input:
          "What are the main differences between the 2021 and 2025 elections in Czechia?",
        expected:
          "The 2025 elections in Czechia are expected to see a shift in the political landscape, with the Pirate Party gaining popularity and potentially forming a coalition government. In contrast, the 2021 elections were dominated by traditional parties like ANO and ODS.",
      },
      {
        input: "When will be Radiohead's next concert in Berlin in 2025/26?",
        expected: "December 8-12, 2025",
      },
      {
        input: "Will there be a NHL game in Edmonton in 15-18 October 2025?",
        expected:
          "No, there will be no NHL games in Edmonton from October 15-18, 2025.",
      },
      {
        input: "When will be Radiohead's next concert in Berlin in 2025/26?",
        expected: "December 8-12, 2025",
      },
      {
        input:
          "Who will accompany David Pastrnak in the first line in Boston in 2025-26 season?",
        expected:
          "David Pastrnak will play together with Jakub Laukos and Patrice Bergeron.",
      },
      //       {
      //         input: "What is the latest version of TypeScript?",
      //         expected: `TypeScript 5.9.2 (latest patch of 5.9) was released July 31, 2025. Install with: npm install --save-dev typescript@latest (or pnpm add -D typescript). Key 5.9 highlights: improved control flow narrowing in complex conditional chains, faster incremental builds via optimized project reference invalidation, expanded JSDoc support (stricter @deprecated and @example formatting checks), better inference for satisfies + template literal types, editor ergonomics improvements (more precise quick fixes & refactor suggestions), and updated lib.d.ts reflecting recent ECMAScript proposals. See official announcement blog “Announcing TypeScript 5.9” for full changelog.`,
      //       },
      //       {
      //         input: "What are the main features of Next.js 15?",
      //         expected: `@next/codemod CLI: Easily upgrade to the latest Next.js and React versions.
      // Async Request APIs (Breaking): Incremental step towards a simplified rendering and caching model.
      // Caching Semantics (Breaking): fetch requests, GET Route Handlers, and client navigations are no longer cached by default.
      // React 19 Support: Support for React 19, React Compiler (Experimental), and hydration error improvements.
      // Turbopack Dev (Stable): Performance and stability improvements.
      // Static Indicator: New visual indicator shows static routes during development.
      // unstable_after API (Experimental): Execute code after a response finishes streaming.
      // instrumentation.js API (Stable): New API for server lifecycle observability.
      // Enhanced Forms (next/form): Enhance HTML forms with client-side navigation.
      // next.config: TypeScript support for next.config.ts.
      // Self-hosting Improvements: More control over Cache-Control headers.
      // Server Actions Security: Unguessable endpoints and removal of unused actions.
      // Bundling External Packages (Stable): New config options for App and Pages Router.
      // ESLint 9 Support: Added support for ESLint 9.
      // Development and Build Performance: Improved build times and Faster Fast Refresh.`,
      //       },
    ];
  },
  task: async (input: string) => {
    const messages: Message[] = [
      { id: "user-1", role: "user", content: input },
    ];
    return askDeepSearch(messages);
  },
  scorers: [
    {
      name: "Contains Links",
      description: "Checks if the output contains any markdown links.",
      scorer: ({ output }) => {
        const markdownLinkRegex = /(?<!\!)\[[^\n\]]+?\]\([^\s)]+\)/g;
        const containsLinks =
          typeof output === "string" && markdownLinkRegex.test(output);
        return containsLinks ? 1 : 0;
      },
    },
    Factuality,
  ],
});
