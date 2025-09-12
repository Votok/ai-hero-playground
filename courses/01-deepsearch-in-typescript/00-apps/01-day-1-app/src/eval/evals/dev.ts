// Dev dataset: smallest set (10-20) focusing on hardest/edge cases for rapid iteration.
// Add or adjust items here as you discover new failure patterns.
export const devData: { input: string; expected: string }[] = [
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
    expected: "Manfred Steyer, July 2024",
  },
];
