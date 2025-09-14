import type { Action } from "./next-action";

// Annotation type sent via dataStream.writeMessageAnnotation to enrich the actively streaming assistant message.
export type OurMessageAnnotation = {
  type: "NEW_ACTION";
  action: Action;
};

export type WriteMessageAnnotationFn = (
  annotation: OurMessageAnnotation,
) => void;
