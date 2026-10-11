"use client";
import Link from "next/link";
import { useLive } from "./LiveProvider";
export function NotificationBell() {
  const { items, update } = useLive();
  const unread = items.filter(item => !item.readAt).length;
  return <Link href="/notifications" aria-label={`Updates${unread ? `, ${unread} unread` : ""}`}
    className="relative flex items-center justify-center min-w-11 min-h-11 rounded-xl border border-white/20 bg-white/5 text-xl shrink-0">
    <span aria-hidden="true">🔔</span>
    {(unread > 0 || update) && <span aria-hidden="true" className="absolute -right-1 -top-1 min-w-4 rounded-full bg-yellow-300 px-1 text-center text-xs font-bold text-slate-950">{unread ? (unread > 9 ? "9+" : unread) : "•"}</span>}
  </Link>;
}
