/**
 * Clip UI (plan 11, 12). Every part reads the service through
 * service/context.ts and needs one ClipUiProvider on the page.
 *
 * Where each part mounts (the GameShell integration step):
 * - ClipUiProvider: once, inside ClipProvider, around the game shell. Give
 *   it GameShell's pause and resume (pauseGame, resumeGame).
 * - ClipButton: the header clipSlot (44 px).
 * - InPlayConfirm: inside the header title region (a relative flex-1 box).
 * - ToastSlot: once, anywhere inside the provider (it portals, z-1050).
 * - ClipsPauseEntry: pauseMenuChildren; CLIPS_PAUSE_ENTRY_SPOKEN in the
 *   pause menu's spokenExtras.
 * - ResultChipClipActions: the ResultChip children; the words from
 *   useResultChipClipSpokenExtras in its spokenExtras.
 * The provider renders the Capture menu, the viewer and the settings sheet
 * (z-2500) itself.
 */

export {
  ClipUiProvider,
  ClipUiRuntime,
  ClipUiContext,
  useClipUi,
  useClipUiState,
  type ClipUiProviderProps,
  type ClipUiRuntimeProps,
} from "./ClipUiProvider";
export { ClipButton, type ClipButtonProps } from "./ClipButton";
export { CaptureMenu, type CaptureMenuProps } from "./CaptureMenu";
export { InPlayConfirm, CONFIRM_MS } from "./InPlayConfirm";
export { ToastSlot, planToastSlot, TOAST_SLOT_Z_INDEX, type ToastSlotPlan } from "./ToastSlot";
export { ClipViewer, type ClipViewerProps } from "./ClipViewer";
export { ClipTile, type ClipTileProps } from "./ClipTile";
export { ClipSettingsSheet, type ClipSettingsSheetProps } from "./ClipSettingsSheet";
export { ClipsPauseEntry, CLIPS_PAUSE_ENTRY_SPOKEN, type ClipsPauseEntryProps } from "./ClipsPauseEntry";
export {
  ResultChipClipActions,
  resultChipClipActions,
  useResultChipClipSpokenExtras,
  type ResultChipClipAction,
  type ResultChipClipActionsProps,
} from "./ResultChipClipActions";
export { Sheet, CLIP_SHEET_Z_INDEX, type SheetProps } from "./Sheet";
export * from "./copy";
export { clipGameInfo, formatBytes, formatDuration, type ClipGameInfo } from "./format";
export { detectSavePlatform } from "./platform";
export {
  createClipPress,
  outcomeForPress,
  outcomeForState,
  COMPAT_CLICK_WINDOW_MS,
  PRESS_SLOP_PX,
  type ClipPress,
  type TapOutcome,
  type TapSource,
} from "./pressGesture";
export {
  createClipUiController,
  createClipUiStore,
  type ClipUiController,
  type ClipUiHost,
  type ClipUiState,
  type MenuSource,
  type SheetState,
  type ViewerTarget,
} from "./uiStore";
export { matchClipHotkey } from "./hotkeys";
export { clipButtonFor, parseVendorProduct, BACK_HOLD_MS, NO_GAMEPAD_CLIP_APPS } from "./gamepad";
export { faceFor, type FaceLook } from "./buttonFace";
