// Shared game audio. Every game and app plays its sound through this bus,
// so clips can hear it. See design/ARCHITECTURE.md, section "Audio".

export {
  getGameAudio,
  getGameAudioTapPoint,
  unlockGameAudio,
  LIMITER_SETTINGS,
  UNLOCK_EVENTS,
} from "./gameAudio";
export type {
  GameAudio,
  GameAudioChannel,
  GameAudioState,
  GameAudioStateListener,
} from "./gameAudio";

export {
  buildAudioShimSource,
  AUDIO_SHIM_BEGIN_MARKER,
  AUDIO_SHIM_END_MARKER,
  AUDIO_SHIM_GLOBAL,
  AUDIO_SHIM_VERSION,
} from "./audioShim";
export type {
  RealmAudioBus,
  RealmAudioBusEntry,
  WindowWithAudioShim,
} from "./audioShim";
