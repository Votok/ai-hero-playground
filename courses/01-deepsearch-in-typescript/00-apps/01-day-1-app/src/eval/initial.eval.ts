import { evalite } from "evalite";
import { askDeepSearch } from "~/lib/deep-search";
import type { Message } from "ai";

evalite("Deep Search Eval", {
  data: async (): Promise<{ input: Message[] }[]> => {
    return [
      {
        input: [
          {
            id: "1",
            role: "user",
            content: "What is the latest version of TypeScript?",
          },
        ],
      },
      {
        input: [
          {
            id: "2",
            role: "user",
            content: "What are the main features of Next.js 15?",
          },
        ],
      },
    ];
  },
  task: async (input) => {
    return askDeepSearch(input);
  },
  scorers: [
    {
      name: "Contains Links",
      description: "Checks if the output contains any markdown links.",
      scorer: ({ output }) => {
        // Match standard markdown links: [text](url) avoiding images ![alt](url)
        // text: anything but newline or ] (lazy); url: anything but ) or whitespace
        const markdownLinkRegex = /(?<!\!)\[[^\n\]]+?\]\([^\s)]+\)/g; // negative lookbehind to exclude images
        const containsLinks =
          typeof output === "string" && markdownLinkRegex.test(output);
        return containsLinks ? 1 : 0; // deterministic binary score
      },
    },
  ],
});
