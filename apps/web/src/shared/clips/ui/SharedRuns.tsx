"use client";
import { SHARING_COPY } from "./copy";
import { useEffect, useState } from "react";
import type { SharedGameRunsResponse } from "@/lib/leaderboard-clips/contract";
import { LEADERBOARD_CLIPS_API } from "@/lib/leaderboard-clips/contract";
import { isGameVideoGame } from "@/lib/game-video-games";
import { ReadAloudButton } from "@/shared/components/ReadAloudButton";
import { currentSessionUser } from "../service/registry";
import { useClipSession } from "./useClipSession";
import { PublicClipViewer } from "./PublicClipViewer";

/** Public game videos have their own gallery, without inventing ranks or scores. */
export function SharedRuns({ appId }: { appId: string }) {
  const session = useClipSession();
  const [loaded, setLoaded] = useState<{ appId: string; owner: typeof session; data: SharedGameRunsResponse } | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [watch, setWatch] = useState<{ id: string; handle: string } | null>(null);
  const [hidden, setHidden] = useState<Set<string>>(() => new Set());
  const [removing, setRemoving] = useState(false);
  const [message, setMessage] = useState("");
  const data = loaded?.appId === appId && loaded.owner === session ? loaded.data : null;
  useEffect(() => {
    if (!isGameVideoGame(appId)) return;
    const controller = new AbortController();
    fetch(`/api/leaderboard-clips?appId=${encodeURIComponent(appId)}`, { cache: "no-store", signal: controller.signal }).then(async (response) => {
      if (!response.ok) throw new Error("feed");
      const data = await response.json() as SharedGameRunsResponse;
      if (!controller.signal.aborted) { setLoaded({ appId, owner: session, data }); setError(false); }
    }).catch(() => { if (!controller.signal.aborted) setError(true); });
    return () => controller.abort();
  }, [appId, session, attempt]);
  if (!isGameVideoGame(appId)) return null;
  const hide = (id: string) => setHidden((before) => new Set([...before, id]));
  const myClip = data?.myClip?.clip;
  const remove = async () => {
    if (!myClip || !session?.userId || removing) return;
    const captured = session;
    setRemoving(true);
    try {
      const response = await fetch(LEADERBOARD_CLIPS_API.remove(myClip.id), { method: "DELETE", headers: { "x-hh-expected-owner": captured.userId! } });
      if (currentSessionUser() !== captured) return;
      if (!response.ok) throw new Error("remove");
      hide(myClip.id); setMessage(SHARING_COPY.yourVideoIsOffTheSite);
    } catch { if (currentSessionUser() === captured) setMessage(SHARING_COPY.weCouldnTTakeItOffYet); }
    finally { setRemoving(false); }
  };
  return <section aria-label={SHARING_COPY.sharedRuns} className="mt-5 rounded-xl border border-slate-600 bg-slate-900 p-3 text-white">
    <div className="mb-2 flex items-center justify-between gap-2"><h3 className="text-xl font-bold">{SHARING_COPY.sharedRuns}</h3><ReadAloudButton variant="icon" text={SHARING_COPY.sharedRunsWatchVideosFromThisGame} /></div>
    <p className="mb-3 text-sm text-slate-300">{SHARING_COPY.gameplayFromThisGameTheseVideosHave}</p>
    {error ? (<><p role="status">{SHARING_COPY.sharedRunsCouldNotLoad}</p><button className="btn btn-primary min-h-12" onClick={() => setAttempt((n) => n + 1)}>{SHARING_COPY.trySharedRunsAgain}</button></>) : !data ? (<p role="status">{SHARING_COPY.loadingSharedRuns}</p>) : !data.enabled ? (<p role="status">{SHARING_COPY.publicVideosAreUnavailableRightNowYou}</p>) : (<>
      {data.runs.filter((run) => !hidden.has(run.clip.id)).length === 0 && <p>{SHARING_COPY.noSharedRunsYetUseShareGameplay}</p>}
      <ul className="flex flex-col gap-2">{data.runs.filter((run) => !hidden.has(run.clip.id)).map(({ handle, clip }) => <li key={clip.id} className="flex flex-wrap items-center gap-3 rounded-lg bg-slate-800 p-3">
        <div className="min-w-0 flex-1"><p className="break-words font-semibold">{handle}</p><p className="text-sm text-slate-300">{Math.round(clip.durationMs / 1000)} seconds{clip.runScore != null ? ` · Run score: ${clip.runScore.toLocaleString()}` : ""}</p></div>
        <button className="btn btn-primary min-h-12" onClick={() => setWatch({ id: clip.id, handle })} aria-label={`Watch ${handle}'s shared run`}>{SHARING_COPY.watch}</button>
      </li>)}</ul>
    </>)}
    {myClip && !hidden.has(myClip.id) && <div className="mt-3 border-t border-slate-600 pt-3"><p>{data?.myClip?.clipStatus === "hidden" ? SHARING_COPY.yourVideoWasHiddenAfterAReport : SHARING_COPY.yourSharedVideo}</p>
      <button className="btn btn-outline mt-2 min-h-12 text-white" disabled={removing} onClick={() => void remove()}>{SHARING_COPY.takeMyVideoOff}</button></div>}
    {message && <p role="status" className="mt-2">{message}</p>}
    {watch && <PublicClipViewer key={watch.id} id={watch.id} handle={watch.handle} canRemove={myClip?.id === watch.id} onClose={() => setWatch(null)} onHidden={hide} />}
  </section>;
}
