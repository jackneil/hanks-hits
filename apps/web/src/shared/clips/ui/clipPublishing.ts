import { LEADERBOARD_CLIPS_API, type UploadLeaderboardClipResponse } from "@/lib/leaderboard-clips/contract";
import type { ClipRecord } from "../protocol";

export class ClipPublishError extends Error {
  constructor(public readonly code: string) { super(code); }
}

export { publishErrorCopy } from "./copy";

/** Decode recorder-owned bytes locally; fetching data: would require a CSP network exception. */
export function posterBlobFromDataUrl(dataUrl: string): Blob {
  const prefix = "data:image/jpeg;base64,";
  if (!dataUrl.startsWith(prefix)) throw new ClipPublishError("bad_poster");
  try {
    const binary = atob(dataUrl.slice(prefix.length));
    if (!binary.length) throw new ClipPublishError("bad_poster");
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    return new Blob([bytes], { type: "image/jpeg" });
  } catch { throw new ClipPublishError("bad_poster"); }
}

/** Use only the game's captured run score. A missing score has no numeric substitute. */
export function publishForm(record: ClipRecord, file: File, poster: Blob): FormData {
  const form = new FormData();
  form.append("appId", record.gameId);
  form.append("video", file, file.name);
  form.append("poster", poster, "cover.jpg");
  if (typeof record.challengeScore === "number" && Number.isFinite(record.challengeScore)) {
    form.append("runScore", String(record.challengeScore));
  }
  return form;
}

/** XHR supplies real byte progress. Cancelling never removes the local video. */
export function uploadClip(record: ClipRecord, file: File, poster: Blob, owner: string,
  signal: AbortSignal, progress: (percent: number) => void): Promise<UploadLeaderboardClipResponse> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const abort = () => { xhr.abort(); reject(new ClipPublishError("owner_changed")); };
    if (signal.aborted) { abort(); return; }
    xhr.open("POST", LEADERBOARD_CLIPS_API.upload(record.gameId));
    xhr.setRequestHeader("x-hh-expected-owner", owner);
    xhr.responseType = "json";
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) progress(Math.min(99, Math.round(100 * event.loaded / event.total)));
    };
    const cleanup = () => signal.removeEventListener("abort", abort);
    xhr.onload = () => {
      cleanup();
      if (xhr.status === 201 && xhr.response?.clip?.id) resolve(xhr.response as UploadLeaderboardClipResponse);
      else reject(new ClipPublishError(xhr.response?.code ?? "server_error"));
    };
    xhr.onerror = () => { cleanup(); reject(new ClipPublishError("network")); };
    xhr.onabort = () => { cleanup(); reject(new ClipPublishError("cancelled")); };
    signal.addEventListener("abort", abort, { once: true });
    xhr.send(publishForm(record, file, poster));
  });
}

export function clipWatchHref(id: string, gameId: string): string {
  return `/clips/${encodeURIComponent(id)}?game=${encodeURIComponent(gameId)}`;
}

export { safeReturnTo } from "@/lib/safe-return-to";
