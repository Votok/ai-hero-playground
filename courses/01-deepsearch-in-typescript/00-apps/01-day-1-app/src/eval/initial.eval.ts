import { evalite } from "evalite";
import { askDeepSearch } from "~/lib/deep-search";
import type { Message } from "ai";
import { Factuality } from "./factuality-scorer";
import { devData } from "./evals/dev";
import { ciData } from "./evals/ci";
import { regressionData } from "./evals/regression";
import { env } from "~/env";

evalite("Deep Search Eval", {
  data: async (): Promise<{ input: string; expected: string }[]> => {
    // Start with dev data cloned to avoid mutating originals.
    const data = [...devData];
    if (env.EVAL_DATASET === "ci") {
      data.push(...ciData);
    } else if (env.EVAL_DATASET === "regression") {
      data.push(...ciData, ...regressionData);
    }
    return data;
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
