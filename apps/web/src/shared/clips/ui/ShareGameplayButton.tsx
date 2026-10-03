"use client";
import { SHARING_COPY } from "./copy";
import { useState } from "react";
import { useSecondFingerClick } from "@/shared/lib/input";
import { useClipUi } from "./uiContext";
import { Sheet } from "./Sheet";

/** A named entry point, including when capture is still loading or unavailable. */
export function ShareGameplayButton({ className = "" }: { className?: string }) {
  const ui = useClipUi();
  const [explain, setExplain] = useState(false);
  const tap = useSecondFingerClick(() => {
    if (ui) ui.openSharingMenu();
    else setExplain(true);
  });
  return <>
    <button type="button" {...tap} aria-haspopup="dialog" className={`btn min-h-11 h-auto whitespace-normal px-3 py-2 normal-case ${className}`}>{SHARING_COPY.shareGameplay}</button>
    {explain && <Sheet title={SHARING_COPY.shareGameplay} variant="menu" onClose={() => setExplain(false)} readAloudText={() => SHARING_COPY.gameplayCaptureIsNotReadyOnThis}>
      <p className="mb-3">{SHARING_COPY.gameplayCaptureIsNotReadyOnThis}</p>
      <button className="btn btn-primary min-h-12" onClick={() => { setExplain(false); if (ui) ui.openSharingMenu(); }}>{ui ? SHARING_COPY.openCapture : SHARING_COPY.backToGame}</button>
    </Sheet>}
  </>;
}
