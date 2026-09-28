// The game-audio bus rule: one source of truth for the ESLint ban
// (apps/web/eslint.config.mjs) and the source-scan test
// (src/shared/lib/audio/__tests__/audioBusSources.test.ts).
//
// Plain ESM JavaScript, not TypeScript: eslint.config.mjs loads it with
// Node, with no build step. Paths are relative to apps/web.

/** The one message for every banned form. */
export const AUDIO_BUS_MESSAGE =
  "Use getGameAudio() from @/shared/lib/audio so clips can hear your game";

/** The rule covers every game and app module. */
export const AUDIO_BUS_LINT_FILES = Object.freeze([
  "src/games/**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}",
  "src/apps/**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}",
]);

/** Tests may build fake audio objects. They make no sound for a player. */
export const AUDIO_BUS_TEST_IGNORES = Object.freeze([
  "**/__tests__/**",
  "**/*.{test,spec}.*",
]);

const DESTINATION_HINT =
  ". Connect sounds to channel.input, never to .destination. (Not sound? Give the field another name: .destination is kept for the speakers.)";

/**
 * no-restricted-syntax entries. Each form makes sound that skips the bus,
 * so a clip cannot hear it and the game's sound switch cannot mute it.
 */
export const AUDIO_BUS_RESTRICTED_SYNTAX = Object.freeze([
  // new AudioContext()
  { selector: "NewExpression[callee.name='AudioContext']", message: AUDIO_BUS_MESSAGE },
  // window.AudioContext, globalThis.AudioContext, self.AudioContext (this
  // also covers new window.AudioContext() and new (window.AudioContext || x)())
  {
    selector:
      "MemberExpression[object.name=/^(window|globalThis|self)$/][property.name='AudioContext']",
    message: AUDIO_BUS_MESSAGE,
  },
  // webkitAudioContext, in any form
  { selector: "Identifier[name='webkitAudioContext']", message: AUDIO_BUS_MESSAGE },
  // ctx.destination and ctx["destination"]
  {
    selector: "MemberExpression[computed=false][property.name='destination']",
    message: AUDIO_BUS_MESSAGE + DESTINATION_HINT,
  },
  {
    selector: "MemberExpression[computed=true][property.value='destination']",
    message: AUDIO_BUS_MESSAGE + DESTINATION_HINT,
  },
  // new Audio(...) and new window.Audio(...): an audio element goes
  // straight to the speakers.
  { selector: "NewExpression[callee.name='Audio']", message: AUDIO_BUS_MESSAGE },
  { selector: "NewExpression[callee.property.name='Audio']", message: AUDIO_BUS_MESSAGE },
  // document.createElement("audio") and <audio>: the same element.
  {
    selector: "CallExpression[callee.property.name='createElement'][arguments.0.value='audio']",
    message: AUDIO_BUS_MESSAGE,
  },
  { selector: "JSXOpeningElement[name.name='audio']", message: AUDIO_BUS_MESSAGE },
]);

/**
 * LEGACY: files that still make their own sound today. The ESLint rule
 * skips them and the source-scan test allows them.
 *
 * Each migration PR removes its own files from this list. Never add a
 * file: new sound code uses getGameAudio(). The source-scan test fails
 * when a listed file no longer breaks the rule (so the entry must go) or
 * no longer exists, so this list can only get shorter.
 */
export const LEGACY_AUDIO_SITES = Object.freeze([
  // Canvas games: each makes its own AudioContext and plays to ctx.destination.
  "src/games/asteroids/lib/store.ts",
  "src/games/bomberman/lib/store.ts",
  "src/games/breakout/lib/store.ts",
  "src/games/hextris/lib/store.ts",
  "src/games/space-invaders/Game.tsx",
  // 3D games. Four-Wheeler 3D has four contexts and closes three of them.
  "src/games/monster-truck/lib/sounds.ts",
  "src/games/four-wheeler-3d/components/Hunting.tsx",
  "src/games/four-wheeler-3d/components/TransportActions.tsx",
  "src/games/four-wheeler-3d/lib/radioAudio.ts",
  "src/games/four-wheeler-3d/lib/sounds.ts",
  // Apps with sound and no start card.
  "src/apps/drum-machine/lib/store.ts",
  "src/apps/virtual-pet/lib/store.ts",
  // Iframe realm (a static HTML game; the source-scan test covers it, ESLint
  // does not read HTML). Its file stays as Hank wrote it. When its host
  // prepends buildAudioShimSource(), move it to SHIMMED_REALM_DOCUMENTS.
  "public/games/four-wheeler-adventure/index.html",
]);

/**
 * Static HTML games that make their own AudioContext, mapped to the host
 * module that prepends buildAudioShimSource() to them at run time. The
 * shim turns each such context into a bus the clip service can hear. The
 * source-scan test checks that each host file uses buildAudioShimSource.
 *
 * Example entry:
 *   "public/games/four-wheeler-adventure/index.html":
 *     "src/games/four-wheeler-adventure/Game.tsx",
 *
 * @type {Readonly<Record<string, string>>}
 */
export const SHIMMED_REALM_DOCUMENTS = Object.freeze({});
