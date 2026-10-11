"use client";
import { SHARING_COPY } from "./copy";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { LEADERBOARD_CLIP_LIMITS } from "@/lib/leaderboard-clips/contract";
import { isGameVideoGame } from "@/lib/game-video-games";
import { prepareGuestPublish } from "@/shared/clips";
import type { ClipRecord } from "../protocol";
import { ownerKeyFor } from "../library/ownerKey";
import { currentSessionUser } from "../service/registry";
import { shareLink } from "../service/share";
import { useClipSession } from "./useClipSession";
import { absoluteClipWatchUrl, clipWatchHref, copyText, ClipPublishError, publishErrorCopy, posterBlobFromDataUrl, uploadClip } from "./clipPublishing";
import { canShareLink, subscribeToNothing } from "./platform";

function publicMessage(copied: boolean): string {
  const lead = SHARING_COPY.yourVideoIsOnTheLeaderboard;
  return copied ? `${lead} ${SHARING_COPY.linkCopiedSendIt}` : `${lead} ${SHARING_COPY.linkIsInTheBox}`;
}

const BUTTON = "btn h-auto min-h-14 w-full whitespace-normal px-4 py-3 text-lg normal-case";

/** The preceding local player is the preview; only this explicit tap sends it publicly. */
export function ClipPublishPanel({ record, file }: { record: ClipRecord; file: File | null }) {
  const session = useClipSession();
  const router = useRouter();
  const linkShareOk = useSyncExternalStore(subscribeToNothing, () => canShareLink(), () => false);
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [configFailed, setConfigFailed] = useState(false);
  const [configAttempt, setConfigAttempt] = useState(0);
  const [sending, setSending] = useState(false);
  const [percent, setPercent] = useState(0);
  const [message, setMessage] = useState("");
  const [published, setPublished] = useState<string | null>(null);
  const [watchUrl, setWatchUrl] = useState<string | null>(null);
  const pending = useRef<AbortController | null>(null);
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => { active.current = false; pending.current?.abort(); };
  }, []);
  useEffect(() => () => { pending.current?.abort(); }, [session]);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/leaderboard-clips", { cache: "no-store", signal: controller.signal }).then(async (response) => {
      if (!response.ok) throw new Error("config");
      const config = await response.json();
      if (!controller.signal.aborted) { setEnabled(config.enabled === true); setConfigFailed(false); }
    }).catch(() => { if (!controller.signal.aborted) setConfigFailed(true); });
    return () => controller.abort();
  }, [configAttempt]);

  if (!isGameVideoGame(record.gameId) || record.kind === "picture") return null;
  const unavailable = !record.mime.startsWith("video/mp4")
    ? SHARING_COPY.thisBrowserMadeAVideoForYour
    : record.durationMs > LEADERBOARD_CLIP_LIMITS.maxDurationMs || (file?.size ?? record.bytes) > LEADERBOARD_CLIP_LIMITS.maxVideoBytes
      ? SHARING_COPY.thisVideoIsTooLongOrToo
      : null;

  const stillCurrent = (captured: typeof session) => active.current && currentSessionUser() === captured;
  const publish = async () => {
    if (!file || !session?.userId || pending.current || !enabled || unavailable) return;
    const captured = session;
    const controller = new AbortController();
    pending.current = controller;
    setSending(true); setPercent(0); setMessage("");
    try {
      const key = await ownerKeyFor(captured.userId);
      if (!stillCurrent(captured) || key !== record.ownerKey) throw new ClipPublishError("owner_changed");
      const poster = posterBlobFromDataUrl(record.posterDataUrl);
      if (!stillCurrent(captured)) throw new ClipPublishError("owner_changed");
      const result = await uploadClip(record, file, poster, captured.userId!, controller.signal, (value) => {
        if (stillCurrent(captured)) setPercent(value);
      });
      if (stillCurrent(captured)) {
        setPublished(result.clip.id);
        if (!result.publicListing) {
          setWatchUrl(null);
          setMessage(SHARING_COPY.yourVideoIsSavedPrivatelyTurnOn);
        } else {
          const url = absoluteClipWatchUrl(result.clip.id, record.gameId);
          setWatchUrl(url);
          const copied = await copyText(url);
          if (stillCurrent(captured)) setMessage(publicMessage(copied));
        }
      }
    } catch (error) {
      if (stillCurrent(captured)) setMessage(publishErrorCopy(error instanceof ClipPublishError ? error.code : "network"));
    } finally {
      pending.current = null;
      if (stillCurrent(captured)) setSending(false);
    }
  };
  const signIn = async () => {
    if (pending.current || sending || !session || session.userId !== null) return;
    const captured = session;
    pending.current = new AbortController();
    setSending(true); setMessage("");
    try {
      await prepareGuestPublish(record.id);
      if (!stillCurrent(captured)) return;
      const returnTo = window.location.pathname + window.location.search;
      router.push(`/login?returnTo=${encodeURIComponent(returnTo)}`);
    } catch {
      if (stillCurrent(captured)) { setMessage(SHARING_COPY.weCouldnTKeepThisVideoThrough); setSending(false); }
    } finally { pending.current = null; }
  };

  const copyWatchLink = () => {
    if (!watchUrl) return;
    void copyText(watchUrl).then((copied) => {
      if (active.current) setMessage(publicMessage(copied));
    });
  };
  const sendWatchLink = () => {
    if (!watchUrl) return;
    void shareLink(watchUrl, SHARING_COPY.watchThisRun, SHARING_COPY.watchThisRun);
  };

  return <section aria-label={SHARING_COPY.publishGameplay} className="mb-4 flex flex-col gap-2 rounded-xl border border-primary/40 bg-base-200 p-3">
    <h3 className="text-lg font-bold">{SHARING_COPY.putItOnTheLeaderboard}</h3>
    <p className="text-sm">{SHARING_COPY.publishExplainer}{" "}<a className="link" href="/profile">{SHARING_COPY.checkProfileVisibility}</a>.</p>
    {unavailable ? (<p role="status">{unavailable}</p>) : configFailed ? (<>
      <p role="status">{SHARING_COPY.weCouldNotCheckPublicSharingYour}</p>
      <button className={`${BUTTON} btn-outline`} onClick={() => setConfigAttempt((n) => n + 1)}>{SHARING_COPY.tryCheckingAgain}</button>
    </>) : enabled === null ? (<p role="status">{SHARING_COPY.checkingPublicSharing}</p>) : !enabled ? (<p role="status">{SHARING_COPY.publicSharingIsUnavailableRightNowYou}</p>)
      : published ? (
        <div className="flex flex-col gap-2">
          {watchUrl && (<>
            <label htmlFor={`clip-watch-link-${published}`} className="text-sm font-semibold">{SHARING_COPY.linkToThisVideo}</label>
            <input id={`clip-watch-link-${published}`} readOnly value={watchUrl} className="input input-bordered w-full text-base" onFocus={(event) => event.currentTarget.select()} />
            <button type="button" className={`${BUTTON} btn-primary`} onClick={copyWatchLink}>{SHARING_COPY.copyLink}</button>
            {linkShareOk && <button type="button" className={`${BUTTON} btn-outline`} onClick={sendWatchLink}>{SHARING_COPY.shareLink}</button>}
          </>)}
          <a className={`${BUTTON} ${watchUrl ? "btn-outline" : "btn-primary"}`} href={clipWatchHref(published, record.gameId)}>{SHARING_COPY.watchMyVideo}</a>
        </div>
      )
      : !session ? (<p role="status">{SHARING_COPY.checkingTheSignedInPlayer}</p>)
      : !session.userId ? (<button className={`${BUTTON} btn-primary`} disabled={sending || !file} onClick={() => void signIn()}>{SHARING_COPY.signInToPublishThisVideo}</button>)
      : (<button className={`${BUTTON} btn-primary`} disabled={sending || !file} onClick={() => void publish()}>{sending ? SHARING_COPY.sendingVideo : message ? SHARING_COPY.tryPublishingAgain : SHARING_COPY.publishAndCopyLink}</button>)}
    {sending && session?.userId && <><progress className="progress progress-primary w-full" value={percent} max={100} aria-label={SHARING_COPY.videoUploadProgress} /><p role="status">{percent}% sent. {percent === 99 ? SHARING_COPY.finishingYourVideo : SHARING_COPY.yourLocalCopyStaysSafe}</p></>}
    {message && <p role="status" aria-live="polite">{message}</p>}
  </section>;
}
