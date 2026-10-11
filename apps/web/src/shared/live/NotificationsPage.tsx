"use client";
import Link from "next/link";
import { useState } from "react";
import { Header } from "@/shared/components/Header";
import { getGameMetadata } from "@/shared/lib/gameMetadata.generated";
import { useLive, type NotificationItem } from "./LiveProvider";
import { ReleaseNotice } from "./ReleaseNotice";

export function notificationWords(item: NotificationItem): string {
  const name = getGameMetadata(item.appId).name;
  if (item.kind === "first_place") return `You're in first place in ${name}!`;
  if (item.kind === "top_ten") return `You reached the top 10 in ${name}!`;
  return `${item.actorHandle || "Another player"} passed your score in ${name}. Ready for another round?`;
}
export function NotificationsPage() {
  const { items, error, loading, refresh, markRead, signedIn } = useLive();
  const [pending, setPending] = useState<string | null>(null);
  const [readError, setReadError] = useState(false);
  async function read(id: string) {
    setPending(id); setReadError(false);
    try { if (!await markRead(id)) setReadError(true); } finally { setPending(null); }
  }
  return <div className="min-h-dvh bg-slate-950 text-white">
    <Header title="Your Updates" titleIcon="🔔" />
    <main className="mx-auto max-w-2xl p-4 pb-12">
      <ReleaseNotice inbox />
      <h2 className="my-4 text-xl font-bold text-yellow-300">What&apos;s happening</h2>
      {!signedIn ? <p>Sign in to see your score and ranking updates. <Link className="underline text-cyan-300" href="/login">Sign in</Link></p>
        : loading ? <p role="status">Loading your updates...</p>
        : !items.length && !error ? <p className="text-slate-300">You&apos;re all caught up! Play a game and watch for new score and ranking updates here.</p> : null}
      {error && <div role="alert"><p>{error}</p><button onClick={refresh} className="my-2 min-h-11 rounded-lg border border-slate-500 px-4">Try again</button></div>}
      {readError && <p role="alert" className="my-2 text-amber-200">That update could not be marked read. Try again.</p>}
      <ul className="space-y-3">{items.map(item => <li key={item.id} className={`rounded-2xl border p-4 ${item.readAt ? "border-white/10 bg-white/5" : "border-yellow-300/40 bg-yellow-300/5"}`}>
        <p className="font-semibold">{!item.readAt && <span className="mr-2 text-yellow-300" aria-label="Unread">●</span>}{notificationWords(item)}</p>
        <time dateTime={item.createdAt} className="mt-1 block text-sm text-slate-400">{new Date(item.createdAt).toLocaleString()}</time>
        <div className="mt-3 flex flex-wrap gap-3"><Link href={`/leaderboards?game=${encodeURIComponent(item.appId)}`} className="flex min-h-11 items-center rounded-lg bg-cyan-300 px-4 font-bold text-slate-950">See leaderboard</Link>
          {!item.readAt && <button disabled={pending !== null} onClick={() => void read(item.id)} className="min-h-11 rounded-lg border border-slate-500 px-4 disabled:opacity-50">{pending === item.id ? "Saving..." : "Mark read"}</button>}</div>
      </li>)}</ul>
      {items.length >= 100 && <p className="mt-4 text-sm text-slate-400">Showing your latest 100 updates.</p>}
    </main>
  </div>;
}
