import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/tests/setup.ts"],
    include: ["src/tests/**/*.test.{ts,tsx}"],
    env: {
      // Tests never hit live services.
      CATALOG_MODE: "mock",
      ALLOW_MOCK_FALLBACK: "true",
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // The real package throws outside a React Server environment; tests
      // exercise server modules directly, so stub it out.
      "server-only": path.resolve(__dirname, "./src/tests/stubs/server-only.ts"),
    },
  },
});
