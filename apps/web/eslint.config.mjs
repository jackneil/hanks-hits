import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

import {
  AUDIO_BUS_LINT_FILES,
  AUDIO_BUS_RESTRICTED_SYNTAX,
  AUDIO_BUS_TEST_IGNORES,
  LEGACY_AUDIO_SITE_PATHS,
} from "./src/shared/lib/audio/audioBusRule.mjs";
import {
  TOUCH_INPUT_RESTRICTED_SYNTAX,
  TOUCH_INPUT_TEST_IGNORES,
} from "./src/shared/lib/input/touchInputRule.mjs";
import {
  POINTER_RELEASE_LINT_FILES,
  POINTER_RELEASE_PLUGIN,
  POINTER_RELEASE_RULE,
  POINTER_RELEASE_TEST_IGNORES,
  pointerReleasePlugin,
} from "./src/shared/lib/input/pointerReleaseRule.mjs";
import {
  BOUNDED_BODY_LINT_FILES,
  BOUNDED_BODY_PLUGIN,
  BOUNDED_BODY_RULE,
  BOUNDED_BODY_TEST_IGNORES,
  boundedBodyPlugin,
} from "./src/lib/boundedBodyRule.mjs";
import {
  WHOLE_STORE_DEPS_LINT_FILES,
  WHOLE_STORE_DEPS_PLUGIN,
  WHOLE_STORE_DEPS_RULE,
  WHOLE_STORE_DEPS_TEST_IGNORES,
  wholeStoreDepsPlugin,
} from "./src/shared/lib/wholeStoreDepsRule.mjs";

// The local rules share one plugin namespace. Flat config refuses two
// different plugin objects under one name, so the rules go in one object.
if (
  POINTER_RELEASE_PLUGIN !== WHOLE_STORE_DEPS_PLUGIN ||
  BOUNDED_BODY_PLUGIN !== WHOLE_STORE_DEPS_PLUGIN
) {
  throw new Error("The local ESLint rules must share one plugin namespace.");
}
const hanksHitsPlugin = Object.freeze({
  meta: { name: "hanks-hits" },
  rules: {
    ...wholeStoreDepsPlugin.rules,
    ...pointerReleasePlugin.rules,
    ...boundedBodyPlugin.rules,
  },
});

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // The local rules (no-whole-store-deps, no-pointerup-position,
    // bounded-request-body). The blocks below turn them on for their files.
    name: "hanks-hits/plugin",
    plugins: { [WHOLE_STORE_DEPS_PLUGIN]: hanksHitsPlugin },
  },
  {
    // Two bans in one no-restricted-syntax list (a later flat-config block
    // replaces the rule, so both sets live together):
    //
    // 1. Game sound goes through the shared game-audio bus (getGameAudio()
    //    in src/shared/lib/audio), so clips can hear it and the game's sound
    //    switch can mute it. This bans new AudioContext, x.AudioContext,
    //    webkitAudioContext, .destination, new Audio(), <audio>, and three.js
    //    or drei audio in every game and app. See design/ARCHITECTURE.md,
    //    section "Audio".
    //
    // 2. One input path per element. React registers touch listeners
    //    passive, so onTouchStart + onClick (or onMouseDown) on one element
    //    runs the action twice per tap, and preventDefault() inside a React
    //    onTouch* handler is a no-op that logs an error. Use usePointerTap
    //    (@/shared/lib/input), usePointerHold or useTouchInput
    //    (@/shared/hooks). See design/ARCHITECTURE.md, section "Touch input".
    name: "hanks-hits/game-audio-bus-and-touch-input",
    files: [...AUDIO_BUS_LINT_FILES],
    ignores: [
      ...AUDIO_BUS_TEST_IGNORES,
      // LEGACY ignore list: the files that break the audio rule today. Each
      // migration PR removes its own files from LEGACY_AUDIO_SITES (in
      // src/shared/lib/audio/audioBusRule.mjs). Never add a file to it. The
      // source-scan test shares the same list: it fails on a stale entry,
      // and on a listed file that gets more bypasses than its ceiling.
      // The block below still applies the touch-input ban to these files.
      ...LEGACY_AUDIO_SITE_PATHS,
    ],
    rules: {
      "no-restricted-syntax": [
        "error",
        ...AUDIO_BUS_RESTRICTED_SYNTAX,
        ...TOUCH_INPUT_RESTRICTED_SYNTAX,
      ],
    },
  },
  {
    // The legacy audio files get the touch-input ban only (their audio
    // bypasses are allowed up to the ceiling in LEGACY_AUDIO_SITES).
    name: "hanks-hits/touch-input-legacy-audio",
    // The list also names a static HTML game, which ESLint cannot parse.
    files: LEGACY_AUDIO_SITE_PATHS.filter((file) => !file.endsWith(".html")),
    ignores: [...TOUCH_INPUT_TEST_IGNORES],
    rules: {
      "no-restricted-syntax": ["error", ...TOUCH_INPUT_RESTRICTED_SYNTAX],
    },
  },
  {
    // A whole Zustand store (useXStore() with no selector) is a new object
    // after every set(), so a hook that lists it in its deps runs again on
    // every state change: a game loop restarts every frame, a listener is
    // removed and added on every tick (issue #56). Read the state with
    // useXStore.getState() in the handler, or use a selector. See
    // src/shared/lib/wholeStoreDepsRule.mjs.
    name: "hanks-hits/no-whole-store-deps",
    files: [...WHOLE_STORE_DEPS_LINT_FILES],
    ignores: [...WHOLE_STORE_DEPS_TEST_IGNORES],
    rules: {
      [`${WHOLE_STORE_DEPS_PLUGIN}/${WHOLE_STORE_DEPS_RULE}`]: "error",
    },
  },
  {
    // A decision about where a pointer let go must not read the position
    // of the pointerup event: iPhone Safari can report a pointerup at
    // (0, 0), so the clip button took every tap for a drag off. Read
    // createPointerTrail().release() from @/shared/lib/input. The rule
    // finds each pointerup binding (JSX onPointerUp, a handler object,
    // addEventListener("pointerup"), onpointerup), follows a handler bound
    // by name to its declaration, and follows the event into the functions
    // of the file that get it. It is a plugin rule, not no-restricted-syntax,
    // so the audio and touch blocks above cannot replace it. See
    // src/shared/lib/input/pointerReleaseRule.mjs and design/ARCHITECTURE.md,
    // section "Touch input".
    name: "hanks-hits/no-pointerup-position",
    files: [...POINTER_RELEASE_LINT_FILES],
    ignores: [...POINTER_RELEASE_TEST_IGNORES],
    rules: {
      [`${POINTER_RELEASE_PLUGIN}/${POINTER_RELEASE_RULE}`]: "error",
    },
  },
  {
    // A route handler has no body limit of its own (no middleware, and the
    // Railway service domain has no Cloudflare in front of it), so
    // request.json() and the other body members hold a body of any size in
    // memory, and so does a library that gets the request (Auth.js). Read a
    // body with readJson or readBody from src/lib/read-body.ts. The rule
    // follows the request through aliases, casts, containers, local calls
    // and destructuring, and it reports a request given to code outside the
    // file (a package such as Auth.js). The route inventory test checks the
    // exports of every route. See src/lib/boundedBodyRule.mjs and design/ARCHITECTURE.md,
    // section "Request bodies".
    name: "hanks-hits/bounded-request-body",
    files: [...BOUNDED_BODY_LINT_FILES],
    ignores: [...BOUNDED_BODY_TEST_IGNORES],
    rules: {
      [`${BOUNDED_BODY_PLUGIN}/${BOUNDED_BODY_RULE}`]: "error",
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
    // Generated by scripts/clips/aac-wasm (Emscripten output, checked by its SHA-256).
    "public/clips/aac/**",
    // Vendored EmulatorJS release files, checked by SHA-256 against their
    // manifest (src/games/retro-arcade/__tests__/emulator-selfhost.test.ts).
    // They are not our code, so lint does not check them.
    "public/emulator/ejs/**",
  ]),
]);

export default eslintConfig;
