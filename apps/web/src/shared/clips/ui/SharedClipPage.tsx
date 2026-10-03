"use client";
import { SHARING_COPY } from "./copy";
import { useState } from "react";
import Link from "next/link";
import { CLIP_ID_PATTERN } from "@/lib/leaderboard-clips/contract";
import { isGameVideoGame } from "@/lib/game-video-games";
import { PublicClipViewer } from "./PublicClipViewer";
import { SharedRuns } from "./SharedRuns";
export function SharedClipPage({ id, gameId }: { id: string; gameId?: string }) {
  const [open, setOpen] = useState(true);
  return <main className="mx-auto min-h-dvh max-w-2xl p-4 text-base-content">
    <h1 className="my-4 text-3xl font-bold">{SHARING_COPY.sharedGameplay}</h1>
    <Link className="btn btn-primary min-h-12" href="/leaderboards">{SHARING_COPY.seeTheLeaderboards}</Link>
    {CLIP_ID_PATTERN.test(id) ? <button className="btn btn-outline m-2 min-h-12" onClick={() => setOpen(true)}>{SHARING_COPY.watchSharedRun}</button> : <p>{SHARING_COPY.thisVideoLinkIsNotAvailable}</p>}
    {isGameVideoGame(gameId) && <SharedRuns appId={gameId} />}
    {open && CLIP_ID_PATTERN.test(id) && <PublicClipViewer id={id} onClose={() => setOpen(false)} />}
  </main>;
}
