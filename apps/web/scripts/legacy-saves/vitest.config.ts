import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

// The src tree to run: LEGACY_SRC (the src of an older commit, which
// generate.sh unpacks), else this checkout's src.
const src = path.resolve(process.env.LEGACY_SRC ?? path.join(__dirname, "../../src"));

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    root: __dirname,
    setupFiles: [path.join(src, "__tests__/setup.ts")],
    // generate.sh runs generate.test.ts; rollback.sh runs new-saves.test.ts
    // and rollback.test.ts.
    include: [process.env.TEST_FILE ?? "generate.test.ts"],
    testTimeout: 60_000,
  },
  resolve: {
    alias: {
      "@": src,
    },
  },
});
