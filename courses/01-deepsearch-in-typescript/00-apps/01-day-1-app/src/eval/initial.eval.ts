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
      {
        input: [
          {
            id: "3",
            role: "user",
            content: "What are notable tech IPOs this year?",
          },
        ],
      },
      {
        input: [
          {
            id: "4",
            role: "user",
            content:
              "Compare the architectures of Vercel AI SDK, LangChain, and LlamaIndex.",
          },
        ],
      },
      {
        input: [
          {
            id: "5",
            role: "user",
            content:
              "Summarize the recent advances in retrieval augmented generation (RAG).",
          },
        ],
      },
      {
        input: [
          {
            id: "6",
            role: "user",
            content:
              "Provide an in-depth overview of vector database design considerations.",
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
