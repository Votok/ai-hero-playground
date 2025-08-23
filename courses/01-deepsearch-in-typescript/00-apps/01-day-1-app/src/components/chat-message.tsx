import ReactMarkdown, { type Components } from "react-markdown";
import type { Message } from "ai";

// Hover over MessagePart to see all possible part variants provided by the AI SDK.
export type MessagePart = NonNullable<Message["parts"]>[number];

interface ChatMessageProps {
  parts?: MessagePart[]; // Message parts (text, tool invocations, etc.)
  role: string;
  userName: string;
}

const components: Components = {
  // Override default elements with custom styling
  p: ({ children }) => <p className="mb-4 first:mt-0 last:mb-0">{children}</p>,
  ul: ({ children }) => <ul className="mb-4 list-disc pl-4">{children}</ul>,
  ol: ({ children }) => <ol className="mb-4 list-decimal pl-4">{children}</ol>,
  li: ({ children }) => <li className="mb-1">{children}</li>,
  code: ({ className, children, ...props }) => (
    <code className={`${className ?? ""}`} {...props}>
      {children}
    </code>
  ),
  pre: ({ children }) => (
    <pre className="mb-4 overflow-x-auto rounded-lg bg-gray-700 p-4">
      {children}
    </pre>
  ),
  a: ({ children, ...props }) => (
    <a
      className="text-blue-400 underline"
      target="_blank"
      rel="noopener noreferrer"
      {...props}
    >
      {children}
    </a>
  ),
};

const Markdown = ({ children }: { children: string }) => {
  return <ReactMarkdown components={components}>{children}</ReactMarkdown>;
};

function ToolInvocationView({
  part,
}: {
  part: Extract<MessagePart, { type: "tool-invocation" }>;
}) {
  const inv = part.toolInvocation;
  const { toolName, args, state } = inv as any;
  const isResult = inv.state === "result";

  return (
    <div className="bg-gray-750/50 my-3 rounded border border-gray-600 bg-gray-800 px-3 py-2 text-xs">
      <div className="mb-1 flex items-center gap-2 font-mono text-[11px] uppercase tracking-wide text-blue-300">
        <span>Tool</span>
        <span className="rounded bg-blue-500/10 px-1.5 py-0.5 font-semibold text-blue-200">
          {toolName}
        </span>
        <span className="text-[10px] lowercase italic text-gray-400">
          {state}
        </span>
      </div>
      <div className="mb-2">
        <div className="mb-1 font-semibold text-gray-300">Args</div>
        <pre className="max-h-56 overflow-auto rounded bg-gray-900 p-2 text-[11px] leading-snug text-gray-200">
          {JSON.stringify(args, null, 2)}
        </pre>
      </div>
      {isResult && "result" in inv && (
        <div className="mb-1">
          <div className="mb-1 font-semibold text-gray-300">Result</div>
          <pre className="max-h-56 overflow-auto rounded bg-gray-900 p-2 text-[11px] leading-snug text-green-200">
            {JSON.stringify((inv as any).result, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}

function renderPart(part: MessagePart, idx: number) {
  switch (part.type) {
    case "text":
      return (
        <div key={idx} className="prose prose-invert max-w-none">
          <Markdown>{part.text}</Markdown>
        </div>
      );
    case "tool-invocation":
      return <ToolInvocationView key={idx} part={part} />;
    // Intentionally ignoring other part types for now (reasoning, source, file, step-start, etc.)
    default:
      // return (
      //   <div key={idx} className="my-2 rounded bg-gray-800 p-2 text-xs italic text-gray-400">
      //     Unsupported part type: {part.type}
      //   </div>
      // );
      return null;
  }
}

export const ChatMessage = ({ parts, role, userName }: ChatMessageProps) => {
  const isAI = role === "assistant";

  return (
    <div className="mb-6">
      <div
        className={`rounded-lg p-4 ${
          isAI ? "bg-gray-800 text-gray-300" : "bg-gray-900 text-gray-300"
        }`}
      >
        <p className="mb-2 text-sm font-semibold text-gray-400">
          {isAI ? "AI" : userName}
        </p>

        {parts && parts.length > 0 ? (
          parts.map((p, i) => renderPart(p, i))
        ) : (
          <div className="text-sm italic text-gray-500">No content</div>
        )}
      </div>
    </div>
  );
};
