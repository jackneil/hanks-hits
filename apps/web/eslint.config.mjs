import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "coverage/**",
    "next-env.d.ts",
    // Vendored EmulatorJS release files, checked by SHA-256 against their
    // manifest (src/games/retro-arcade/__tests__/emulator-selfhost.test.ts).
    // They are not our code, so lint does not check them.
    "public/emulator/ejs/**",
  ]),
]);

export default eslintConfig;
