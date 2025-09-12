// CI dataset: moderate size (50-200). Contains dev set equivalents plus broader coverage.
// Keep items relatively stable to avoid flaky CI.
export const ciData: { input: string; expected: string }[] = [
  // Repeated / similar themes for robustness checks.
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
    input:
      "Who will accompany David Pastrnak in the first line in Boston in 2025-26 season?",
    expected:
      "David Pastrnak will play together with Jakub Laukos and Patrice Bergeron.",
  },
];
