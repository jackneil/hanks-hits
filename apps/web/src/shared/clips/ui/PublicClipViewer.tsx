"use client";
import { SHARING_COPY } from "./copy";
import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { LEADERBOARD_CLIPS_API } from "@/lib/leaderboard-clips/contract";
import { currentSessionUser, onSessionUser } from "../service/registry";
import { useClipSession } from "./useClipSession";
import { Sheet } from "./Sheet";

type ViewerSession = ReturnType<typeof currentSessionUser>;
interface PublicClipViewerProps {
  id: string; handle?: string; canRemove?: boolean; onClose: () => void; onHidden?: (id: string) => void;
}
const sessionKeys = new WeakMap<object, number>();
let nextSessionKey = 0;
function sessionKey(session: ViewerSession): number {
  if (!session) return 0;
  let key = sessionKeys.get(session);
  if (key === undefined) { key = ++nextSessionKey; sessionKeys.set(session, key); }
  return key;
}

/** Reauthorize media and reset every action state for each session object, including A-B-A. */
export function PublicClipViewer(props: PublicClipViewerProps) {
  const session = useClipSession();
  const [openedFor] = useState(session);
  const generation = sessionKey(session);
  return <SessionClipViewer key={`${props.id}:${generation}`} {...props} session={session} generation={generation}
    canRemove={props.canRemove && session === openedFor} />;
}

function discardMedia(video: HTMLVideoElement | null): void {
  if (!video) return;
  // Hide before releasing buffered pixels; this also covers batched account changes before React commits.
  video.hidden = true;
  video.pause();
  video.removeAttribute("src");
  video.removeAttribute("poster");
  video.load();
}

/** Always reload our authorized route after an expired signed URL, never reuse the bucket URL. */
function SessionClipViewer({ id, handle, canRemove = false, onClose, onHidden, session, generation }: PublicClipViewerProps & {
  session: ViewerSession; generation: number;
}) {
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [completed, setCompleted] = useState<"report" | "remove" | null>(null);
  const mounted = useRef(true);
  const request = useRef<AbortController | null>(null);
  const video = useRef<HTMLVideoElement | null>(null);
  const setVideo = useCallback((element: HTMLVideoElement | null) => {
    if (video.current !== element) discardMedia(video.current);
    video.current = element;
  }, []);
  useLayoutEffect(() => {
    mounted.current = currentSessionUser() === session;
    // Strict Mode replays layout effects on the same element. Only restore it for this exact session.
    if (mounted.current && video.current) {
      video.current.hidden = false;
      if (!video.current.hasAttribute("src")) video.current.setAttribute("src", `${LEADERBOARD_CLIPS_API.video(id)}?retry=${attempt}&session=${generation}`);
      if (!video.current.hasAttribute("poster")) video.current.setAttribute("poster", `${LEADERBOARD_CLIPS_API.poster(id)}?retry=${attempt}&session=${generation}`);
    }
    const invalidate = () => {
      mounted.current = false;
      request.current?.abort();
      discardMedia(video.current);
    };
    const unsubscribe = onSessionUser(invalidate);
    return () => { unsubscribe(); invalidate(); };
  }, [session, id, generation, attempt]);
  const act = async (kind: "report" | "remove") => {
    if (!mounted.current || currentSessionUser() !== session || request.current || busy || (kind === "remove" && !session?.userId)) return;
    const captured = session;
    const controller = new AbortController(); request.current = controller;
    setBusy(true); setMessage("");
    // Reporting stops playback immediately, even before the network finishes.
    if (kind === "report") setHidden(true);
    try {
      const response = await fetch(kind === "report" ? LEADERBOARD_CLIPS_API.report(id) : LEADERBOARD_CLIPS_API.remove(id), {
        method: kind === "report" ? "POST" : "DELETE",
        headers: kind === "remove" ? { "x-hh-expected-owner": captured!.userId! } : undefined,
        signal: controller.signal,
      });
      if (!response.ok) { const body = await response.json().catch(() => ({})); throw new Error(body.code ?? "network"); }
      if (!mounted.current || currentSessionUser() !== captured) return;
      setHidden(true); setCompleted(kind); setMessage(kind === "report" ? SHARING_COPY.thanksForTellingUsThisVideoIs : SHARING_COPY.yourVideoIsOffTheSite);
      onHidden?.(id);
    } catch (error) {
      if (mounted.current && currentSessionUser() === captured) setMessage(error instanceof Error && error.message === "owner_changed" ? SHARING_COPY.theSignedInPlayerChangedReopenYour : kind === "report" ? SHARING_COPY.weCouldNotFinishTheReportThe : SHARING_COPY.weCouldNotTakeTheVideoOff);
    } finally { if (request.current === controller) request.current = null; if (mounted.current) setBusy(false); }
  };
  return <Sheet title={handle ? `${handle}'s shared run` : SHARING_COPY.sharedRun} variant="full" onClose={onClose} readAloudText={() => `Shared run. Watch the gameplay video. Report a video to hide it. ${message}`}>
    {!hidden && <video ref={setVideo} key={attempt} src={`${LEADERBOARD_CLIPS_API.video(id)}?retry=${attempt}&session=${generation}`} poster={`${LEADERBOARD_CLIPS_API.poster(id)}?retry=${attempt}&session=${generation}`}
      controls playsInline preload="metadata" className="max-h-[55dvh] w-full rounded-xl bg-black object-contain" aria-label={SHARING_COPY.sharedGameplayVideo} onError={() => { if (mounted.current && currentSessionUser() === session) setFailed(true); }} />}
    {failed && !hidden && <div className="my-3"><p>{SHARING_COPY.thisVideoCouldNotLoadItsLink}</p><button className="btn btn-primary min-h-12" onClick={() => { if (mounted.current && currentSessionUser() === session) { setFailed(false); setAttempt((n) => n + 1); } }}>{SHARING_COPY.tryLoadingVideoAgain}</button></div>}
    <p role="status" aria-live="polite" className="my-3">{message}</p>
    <div className="mt-auto flex flex-col gap-2 pt-3">
      {completed === null && <button className="btn btn-outline min-h-12 whitespace-normal" disabled={busy} onClick={() => void act("report")}>{hidden ? SHARING_COPY.tryReportingAgain : SHARING_COPY.reportAndHideThisVideo}</button>}
      {canRemove && session?.userId && <button className="btn btn-outline min-h-12" disabled={busy || completed === "remove"} onClick={() => void act("remove")}>{SHARING_COPY.takeMyVideoOff}</button>}
    </div>
  </Sheet>;
}
