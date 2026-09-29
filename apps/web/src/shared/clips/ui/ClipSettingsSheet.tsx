"use client";

/**
 * Clip settings (the last row of the Capture menu). It shows how much the
 * clips on this device use, how to clip with a finger, a keyboard and a
 * game controller, and "Turn the clip button back on" while the button
 * rests. PR 5.3 adds the name and timeline settings to this sheet.
 */

import { useEffect, useState } from "react";

import { useClipService, useClipSnapshot } from "../service/context";
import { useClipUi } from "./uiContext";
import { MENU_COPY, SETTINGS_COPY, storageLine } from "./copy";
import { formatBytes } from "./format";
import { NO_GAMEPAD_CLIP_APPS } from "./gamepad";
import { PowerGlyph } from "./glyphs";
import { Sheet } from "./Sheet";

export interface ClipSettingsSheetProps {
  onClose: () => void;
}

/** The how-to tips. The controller tip is left out where the game owns every controller button (Retro Arcade). */
export function clipSettingsTips(appId: string | null): string[] {
  const tips: string[] = [SETTINGS_COPY.tapTip, SETTINGS_COPY.holdTip, SETTINGS_COPY.keyTip];
  if (!(appId !== null && NO_GAMEPAD_CLIP_APPS.has(appId))) tips.push(SETTINGS_COPY.padTip);
  return tips;
}

export function ClipSettingsSheet({ onClose }: ClipSettingsSheetProps) {
  const ui = useClipUi();
  const service = useClipService();
  const snapshot = useClipSnapshot();
  const [usage, setUsage] = useState<{ count: number; bytes: number } | null>(null);

  useEffect(() => {
    if (!service) return;
    let alive = true;
    const load = () => {
      service.library.usage().then(
        (result) => {
          if (alive) setUsage({ count: result.count, bytes: result.bytes });
        },
        () => {
          if (alive) setUsage({ count: 0, bytes: 0 });
        },
      );
    };
    load();
    const unsubscribe = service.library.subscribe(load);
    return () => {
      alive = false;
      unsubscribe();
    };
  }, [service]);

  if (!ui || !service) return null;

  const resting = snapshot.button === "resting";
  const line = usage ? storageLine(usage.count, formatBytes(usage.bytes)) : SETTINGS_COPY.storageLoading;
  const tips = clipSettingsTips(snapshot.appId);
  const readAloud = () =>
    [SETTINGS_COPY.title, resting ? MENU_COPY.wake : null, line, SETTINGS_COPY.whereTip, SETTINGS_COPY.howTitle, ...tips]
      .filter(Boolean)
      .join(". ");

  return (
    <Sheet title={SETTINGS_COPY.title} variant="menu" testId="clip-settings" onClose={onClose} readAloudText={readAloud}>
      {resting && (
        <button
          type="button"
          data-action="wake"
          data-autofocus="true"
          onClick={() => {
            service.wake();
            onClose();
          }}
          className="btn btn-primary btn-block mb-3 h-auto min-h-14 justify-start gap-3 px-4 py-2 text-lg font-semibold normal-case whitespace-normal"
        >
          <PowerGlyph />
          {MENU_COPY.wake}
        </button>
      )}
      <p data-testid="clip-settings-storage" className="text-lg font-semibold">
        {line}
      </p>
      <p className="mb-4 text-base">{SETTINGS_COPY.whereTip}</p>
      <h3 className="mb-2 text-lg font-bold">{SETTINGS_COPY.howTitle}</h3>
      <ul className="flex list-disc flex-col gap-1 pl-6 text-base">
        {tips.map((tip) => (
          <li key={tip}>{tip}</li>
        ))}
      </ul>
    </Sheet>
  );
}
