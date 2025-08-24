import { registerOTel } from "@vercel/otel";
import { LangfuseExporter } from "langfuse-vercel";
import { env } from "~/env";

export function register() {
  // Ensure Langfuse SDK/exporter can read explicit environment variable if it prefers LANGFUSE_ENVIRONMENT
  if (!process.env.LANGFUSE_ENVIRONMENT) {
    process.env.LANGFUSE_ENVIRONMENT = env.NODE_ENV;
  }
  registerOTel({
    serviceName: "langfuse-vercel-ai-nextjs-example",
    traceExporter: new LangfuseExporter({
      environment: env.NODE_ENV,
    }),
  });
}
