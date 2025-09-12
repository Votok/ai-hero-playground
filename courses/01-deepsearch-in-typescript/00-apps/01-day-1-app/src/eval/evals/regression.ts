// Regression dataset: large (500+ normally). Here we just scaffold with a few placeholders.
// Expand over time. Should be additive and rarely remove items except for de-duplication.
export const regressionData: { input: string; expected: string }[] = [
  // Placeholder examples (extend with real historical cases):
  {
    input: "Example historical query 1",
    expected: "Expected answer 1",
  },
  {
    input: "Example historical query 2",
    expected: "Expected answer 2",
  },
];
