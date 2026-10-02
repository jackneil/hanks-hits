import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/__tests__/setup.ts'],
    include: ['src/**/*.{test,spec}.{js,jsx,ts,tsx}'],
    // A timeout exists to catch a hung test, not a slow machine. With the
    // 5 s default, the pass/fail of jsdom render tests and module-import
    // tests depended on machine load: at a load average near 70 (parallel
    // agent sessions and gates), 7 healthy tests crossed 5 s and the gate
    // went red, and the slowest healthy test took 26.5 s. 60 s keeps more
    // than 2x headroom over that and still fails a real hang. Do not add
    // per-test timeouts; fix the test or raise this with evidence.
    testTimeout: 60_000,
    hookTimeout: 60_000,
    server: {
      deps: {
        // next-auth imports "next/server" with no file extension, which
        // Node's ESM loader cannot resolve outside the Next.js bundler.
        // Vite transforms it instead, so a test can run the real Auth.js
        // (src/app/api/auth/[...nextauth]/__tests__/route.test.ts).
        inline: ['next-auth'],
      },
    },
    coverage: {
      reporter: ['text', 'json', 'html'],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
