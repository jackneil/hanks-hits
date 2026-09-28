import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

import {
  AUDIO_BUS_LINT_FILES,
  AUDIO_BUS_RESTRICTED_SYNTAX,
  AUDIO_BUS_TEST_IGNORES,
  LEGACY_AUDIO_SITES,
} from "./src/shared/lib/audio/audioBusRule.mjs";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // Game sound goes through the shared game-audio bus (getGameAudio() in
    // src/shared/lib/audio), so clips can hear it and the game's sound
    // switch can mute it. This bans new AudioContext, window.AudioContext,
    // webkitAudioContext, .destination, new Audio(), and <audio> in every
    // game and app. See design/ARCHITECTURE.md, section "Audio".
    name: "hanks-hits/game-audio-bus",
    files: [...AUDIO_BUS_LINT_FILES],
    ignores: [
      ...AUDIO_BUS_TEST_IGNORES,
      // LEGACY ignore list: the files that break this rule today. Each
      // migration PR removes its own files from LEGACY_AUDIO_SITES (in
      // src/shared/lib/audio/audioBusRule.mjs). Never add a file to it. The
      // source-scan test shares the same list and fails on a stale entry.
      ...LEGACY_AUDIO_SITES,
    ],
    rules: {
      "no-restricted-syntax": ["error", ...AUDIO_BUS_RESTRICTED_SYNTAX],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "coverage/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
