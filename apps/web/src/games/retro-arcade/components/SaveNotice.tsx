"use client";

import { useEffect } from "react";

import { ReadAloudButton } from "@/shared/components/ReadAloudButton";

export type NoticeTone = "info" | "error";

export interface Notice {
  text: string;
  tone: NoticeTone;
}

/** How long a good-news notice stays. A problem stays until the kid taps OK. */
const INFO_MS = 2500;

/**
 * A short message about saves. Good news goes away by itself. A problem
 * stays on the screen, with a read-aloud button and an OK button, so a kid
 * who looks away or cannot read yet does not miss it.
 */
export function SaveNotice({
  notice,
  onDismiss,
  className = "",
}: {
  notice: Notice | null;
  onDismiss: () => void;
  className?: string;
}) {
  useEffect(() => {
    if (!notice || notice.tone !== "info") return;
    const timer = window.setTimeout(onDismiss, INFO_MS);
    return () => window.clearTimeout(timer);
  }, [notice, onDismiss]);

  if (!notice) return null;
  const isError = notice.tone === "error";

  return (
    <div className={`pointer-events-none flex justify-center px-4 ${className}`}>
      <div
        role={isError ? "alert" : "status"}
        data-testid="save-notice"
        className={`pointer-events-auto flex max-w-md items-center gap-3 rounded-xl px-4 py-2 text-base font-bold text-white shadow-lg ${
          isError ? "bg-red-700" : "bg-gray-800"
        }`}
      >
        <span>{notice.text}</span>
        {isError && (
          <>
            <ReadAloudButton text={notice.text} variant="icon" />
            <button
              type="button"
              onClick={onDismiss}
              className="min-h-[44px] min-w-[44px] shrink-0 rounded-lg bg-white/20 px-3 hover:bg-white/30 active:scale-95"
            >
              OK
            </button>
          </>
        )}
      </div>
    </div>
  );
}
