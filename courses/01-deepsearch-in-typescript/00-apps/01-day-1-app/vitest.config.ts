import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  test: {
    setupFiles: ["dotenv/config"],
    testTimeout: 120_000, // extended for network + multi-step eval runs
    hookTimeout: 60_000,
    retry: 1,
  },
  plugins: [tsconfigPaths()],
});
