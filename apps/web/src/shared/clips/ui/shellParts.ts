/**
 * The clip UI parts that GameShell and ResultChip show (plan 11.4).
 *
 * This module is the dynamic-import target of the shell mount
 * (shell/ClipUiMount.tsx). It loads only on the page of a clip-enabled game,
 * and only when the clips flag turns capture on (plan 4.1: "Capture UI and
 * workers load through dynamic import() only when capture is enabled").
 * Never import it statically from a page, a shared component or the barrel.
 */

export { ClipUiRuntime } from "./ClipUiRuntime";
export { ClipButton } from "./ClipButton";
export { InPlayConfirm } from "./InPlayConfirm";
export { ToastSlot } from "./ToastSlot";
export { ClipsPauseEntry } from "./ClipsPauseEntry";
export { ResultChipClipActions } from "./ResultChipClipActions";
