"use client";

import { useEffect, useId, useState } from "react";
import { ReadAloudButton } from "@/shared/components/ReadAloudButton";

/**
 * The one control for gaming_profiles.show_on_leaderboards.
 *
 * It reads and writes the setting through GET and PATCH
 * /api/gaming-profile. When the setting is off, the leaderboards leave
 * the kid out. The label says only what this switch does: it is not the
 * account name and not a clip name (those are separate controls).
 *
 * A kid gets a gamer name (and a gaming profile) the first time a game
 * with a leaderboard saves a score above 0 (POST /api/progress/[appId]).
 * Before that, PATCH has no profile to change, so the switch stays
 * off-limits and says why. The read-aloud button speaks that reason and
 * the save status too, so a kid who cannot read knows why the switch is
 * grey and whether the change saved.
 */

export const LEADERBOARD_NAME_LABEL = "Show my gamer name on leaderboards";

/** Why the switch is locked before the kid has a gamer name. */
export const NO_GAMER_NAME_YET =
  "You get a gamer name when you score points in a game with a 🏆 leaderboard.";

const SPOKEN =
  "Show my gamer name on leaderboards. When this is on, other players can see your gamer name and your best scores. When it is off, the leaderboards leave you out.";

interface GamingProfileSetting {
  handle: string | null;
  showOnLeaderboards: boolean;
}

export function LeaderboardNameToggle() {
  const switchId = useId();
  const [setting, setSetting] = useState<GamingProfileSetting | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ text: string; isError: boolean } | null>(
    null
  );

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const res = await fetch("/api/gaming-profile");
        if (!res.ok) throw new Error(`GET /api/gaming-profile ${res.status}`);
        const data = (await res.json()) as Partial<GamingProfileSetting>;
        if (cancelled) return;
        setSetting({
          handle: typeof data.handle === "string" ? data.handle : null,
          showOnLeaderboards: data.showOnLeaderboards !== false,
        });
      } catch (err) {
        if (cancelled) return;
        console.error("Leaderboard name setting load error:", err);
        setLoadFailed(true);
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const hasProfile = !!setting?.handle;
  const disabled = !setting || !hasProfile || saving;

  const handleChange = async (next: boolean) => {
    if (!setting || !hasProfile || saving) return;
    const previous = setting.showOnLeaderboards;

    // Move the switch at once; put it back if the save fails.
    setSetting({ ...setting, showOnLeaderboards: next });
    setSaving(true);
    setMessage(null);

    try {
      const res = await fetch("/api/gaming-profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ showOnLeaderboards: next }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        showOnLeaderboards?: boolean;
      };
      if (!res.ok) throw new Error(`PATCH /api/gaming-profile ${res.status}`);

      const saved = typeof data.showOnLeaderboards === "boolean" ? data.showOnLeaderboards : next;
      setSetting((s) => (s ? { ...s, showOnLeaderboards: saved } : s));
      setMessage({
        text: saved
          ? "Saved! Your gamer name shows on leaderboards."
          : "Saved! The leaderboards leave you out now.",
        isError: false,
      });
    } catch (err) {
      console.error("Leaderboard name setting save error:", err);
      setSetting((s) => (s ? { ...s, showOnLeaderboards: previous } : s));
      setMessage({ text: "Oops! That did not save. Try again?", isError: true });
    } finally {
      setSaving(false);
    }
  };

  let note: React.ReactNode;
  // The same note as words for the voice.
  let noteText: string;
  if (loadFailed) {
    noteText = "We could not load this setting. Try again later.";
    note = noteText;
  } else if (!setting) {
    noteText = "Loading...";
    note = noteText;
  } else if (!hasProfile) {
    noteText = NO_GAMER_NAME_YET;
    note = noteText;
  } else {
    noteText = `Your gamer name: ${setting.handle}.`;
    note = (
      <>
        Your gamer name: <span className="font-bold text-white">{setting.handle}</span>
      </>
    );
  }

  // Built at tap time: the words, then the note (the lock reason or the
  // gamer name), then the save status. The voice skips the 🏆 picture.
  const spokenText = () => [SPOKEN, noteText, message?.text].filter(Boolean).join(" ");

  return (
    <div data-testid="leaderboard-name-setting" className="mt-6 border-t border-white/20 pt-5">
      <div className="flex items-center gap-3">
        <label
          htmlFor={switchId}
          className={`flex min-h-[44px] flex-1 items-center gap-3 ${
            disabled ? "cursor-not-allowed" : "cursor-pointer"
          }`}
        >
          <input
            id={switchId}
            type="checkbox"
            role="switch"
            className="toggle toggle-lg toggle-success shrink-0"
            checked={setting?.showOnLeaderboards ?? true}
            disabled={disabled}
            aria-describedby={`${switchId}-note`}
            onChange={(e) => handleChange(e.target.checked)}
          />
          <span className="font-bold text-white">{LEADERBOARD_NAME_LABEL}</span>
        </label>
        <ReadAloudButton variant="icon" text={spokenText} />
      </div>

      <p id={`${switchId}-note`} className="mt-1 text-sm text-white/80">
        {note}
      </p>

      <p
        role="status"
        aria-live="polite"
        className={`mt-1 min-h-[1.25rem] text-sm font-bold ${
          message?.isError ? "text-red-200" : "text-green-200"
        }`}
      >
        {message?.text}
      </p>
    </div>
  );
}
