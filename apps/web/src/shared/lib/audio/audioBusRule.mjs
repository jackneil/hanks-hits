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

const THREE_AUDIO_HINT =
  ". three.js and drei audio (Audio, AudioListener, PositionalAudio, AudioLoader) makes its own AudioContext and plays to its destination. Play the sound on a channel of the bus instead.";

/** three.js audio classes. Each one makes (or uses) three's own AudioContext. */
const THREE_AUDIO_CLASSES = "Audio|AudioContext|AudioListener|AudioLoader|PositionalAudio";

/**
 * no-restricted-syntax entries. Each form makes sound that skips the bus,
 * so a clip cannot hear it and the game's sound switch cannot mute it.
 *
 * esquery regex values cannot hold a "/", so a "." stands in for the "/"
 * of "@react-three/drei".
 */
export const AUDIO_BUS_RESTRICTED_SYNTAX = Object.freeze([
  // new AudioContext()
  { selector: "NewExpression[callee.name='AudioContext']", message: AUDIO_BUS_MESSAGE },
  // x.AudioContext on any object: window.AudioContext, (window as any).AudioContext,
  // globalThis.AudioContext, THREE.AudioContext (this also covers
  // new window.AudioContext() and new (window.AudioContext || x)())
  {
    selector: "MemberExpression[computed=false][property.name='AudioContext']",
    message: AUDIO_BUS_MESSAGE,
  },
  // window["AudioContext"] and window["webkitAudioContext"]
  {
    selector: "MemberExpression[computed=true][property.value=/^(webkit)?AudioContext$/]",
    message: AUDIO_BUS_MESSAGE,
  },
  // const { AudioContext } = window
  {
    selector: "ObjectPattern > Property[key.name='AudioContext']",
    message: AUDIO_BUS_MESSAGE,
  },
  // webkitAudioContext, in any form
  { selector: "Identifier[name='webkitAudioContext']", message: AUDIO_BUS_MESSAGE },
  // ctx.destination, ctx["destination"] and const { destination } = ctx
  {
    selector: "MemberExpression[computed=false][property.name='destination']",
    message: AUDIO_BUS_MESSAGE + DESTINATION_HINT,
  },
  {
    selector: "MemberExpression[computed=true][property.value='destination']",
    message: AUDIO_BUS_MESSAGE + DESTINATION_HINT,
  },
  {
    selector: "ObjectPattern > Property[key.name='destination']",
    message: AUDIO_BUS_MESSAGE + DESTINATION_HINT,
  },
  // new Audio(...) and new window.Audio(...) (an audio element goes
  // straight to the speakers), and new THREE.Audio(listener).
  { selector: "NewExpression[callee.name='Audio']", message: AUDIO_BUS_MESSAGE },
  { selector: "NewExpression[callee.property.name='Audio']", message: AUDIO_BUS_MESSAGE },
  // document.createElement("audio") and <audio>: the same element. In a
  // React Three Fiber scene, <audio> is three's Audio: banned too.
  {
    selector: "CallExpression[callee.property.name='createElement'][arguments.0.value='audio']",
    message: AUDIO_BUS_MESSAGE,
  },
  { selector: "JSXOpeningElement[name.name='audio']", message: AUDIO_BUS_MESSAGE },
  // three.js and drei audio: import { PositionalAudio } from "@react-three/drei",
  // import { AudioListener } from "three", THREE.AudioListener,
  // <PositionalAudio />, <positionalAudio />, <audioListener />.
  {
    selector: `ImportDeclaration[source.value=/^(three|@react-three.drei)($|[^a-z])/] > ImportSpecifier[imported.name=/^(${THREE_AUDIO_CLASSES})$/]`,
    message: AUDIO_BUS_MESSAGE + THREE_AUDIO_HINT,
  },
  {
    selector:
      "MemberExpression[computed=false][property.name=/^(AudioListener|AudioLoader|PositionalAudio)$/]",
    message: AUDIO_BUS_MESSAGE + THREE_AUDIO_HINT,
  },
  {
    selector:
      "JSXOpeningElement[name.name=/^(PositionalAudio|positionalAudio|audioListener)$/]",
    message: AUDIO_BUS_MESSAGE + THREE_AUDIO_HINT,
  },
]);

/**
 * LEGACY: files that still make their own sound today, each with its
 * CEILING: the number of bypasses that the source-scan test counts in the
 * file now. The ESLint rule skips these files and the source-scan test
 * allows them, up to the ceiling.
 *
 * The list is a one-way ratchet:
 * - Each migration PR removes its own files from this list.
 * - Never add a file, and never raise a ceiling. New sound code uses
 *   getGameAudio(), also in a file on this list.
 * - The source-scan test fails when a file goes above its ceiling (new
 *   sound code that skips the bus), when it goes below its ceiling (lower
 *   the number), and when a file no longer breaks the rule or no longer
 *   exists (remove the entry).
 *
 * @type {Readonly<Record<string, number>>}
 */
export const LEGACY_AUDIO_SITES = Object.freeze({
  // Canvas games: each makes its own AudioContext and plays to ctx.destination.
  "src/games/asteroids/lib/store.ts": 4,
  "src/games/bomberman/lib/store.ts": 4,
  "src/games/breakout/lib/store.ts": 4,
  "src/games/hextris/lib/store.ts": 4,
  "src/games/space-invaders/Game.tsx": 5,
  // 3D games. Four-Wheeler 3D has four contexts and closes three of them.
  "src/games/monster-truck/lib/sounds.ts": 14,
  "src/games/four-wheeler-3d/components/Hunting.tsx": 3,
  "src/games/four-wheeler-3d/components/TransportActions.tsx": 2,
  "src/games/four-wheeler-3d/lib/radioAudio.ts": 2,
  "src/games/four-wheeler-3d/lib/sounds.ts": 6,
  // Apps with sound and no start card.
  "src/apps/drum-machine/lib/store.ts": 4,
  "src/apps/virtual-pet/lib/store.ts": 4,
  // Iframe realm (a static HTML game; the source-scan test covers it, ESLint
  // does not read HTML). Its file stays as Hank wrote it. When its host
  // prepends buildAudioShimSource(), move it to SHIMMED_REALM_DOCUMENTS.
  "public/games/four-wheeler-adventure/index.html": 7,
});

/** The paths of LEGACY_AUDIO_SITES, for the ESLint ignore list. */
export const LEGACY_AUDIO_SITE_PATHS = Object.freeze(Object.keys(LEGACY_AUDIO_SITES));

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
