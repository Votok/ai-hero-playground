import type { Action } from "./next-action";
import type { QueryPlan } from "./query-rewriter";

// Annotation types sent via dataStream.writeMessageAnnotation to enrich the actively streaming assistant message.
export type OurMessageAnnotation =
  | { type: "NEW_ACTION"; action: Action }
  | { type: "QUERY_PLAN"; plan: string; queries: string[] };

export type WriteMessageAnnotationFn = (
  annotation: OurMessageAnnotation,
) => void;
