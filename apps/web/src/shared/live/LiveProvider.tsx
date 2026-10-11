"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useSession } from "next-auth/react";
import { RELEASE, isNewerRelease, type Release } from "@/lib/live/release";

export type NotificationItem = { id: string; kind: "score_passed" | "top_ten" | "first_place";
  appId: string; actorHandle: string | null; createdAt: string; readAt: string | null };
type LiveState = { items: NotificationItem[]; error: string | null; loading: boolean;
  update: Release | null; refresh: () => void; markRead: (id: string) => Promise<boolean>; signedIn: boolean };
const LiveContext = createContext<LiveState>({ items: [], error: null, loading: false,
  update: null, refresh: () => {}, markRead: async () => false, signedIn: false });
export const useLive = () => useContext(LiveContext);

export function LiveProvider({ children }: { children: ReactNode }) {
  const { data, status } = useSession();
  const userId = status === "authenticated" ? data?.user?.id ?? null : null;
  const [history, setHistory] = useState<{ owner: string | null; items: NotificationItem[]; error: string | null; loading: boolean }>(
    { owner: null, items: [], error: null, loading: false });
  const [update, setUpdate] = useState<Release | null>(null);
  const refreshRef = useRef(() => {});
  const markReadRef = useRef<(id: string) => Promise<boolean>>(async () => false);
  const refresh = useCallback(() => refreshRef.current(), []);
  const markRead = useCallback((id: string) => markReadRef.current(id), []);

  useEffect(() => {
    if (status === "loading") return;
    let disposed = false, socket: WebSocket | null = null, retry: ReturnType<typeof setTimeout> | null = null;
    let attempts = 0, connecting = false, reading = false, readAgain = false;
    const controller = new AbortController();
    const hidden = () => document.visibilityState === "hidden";
    const request = (url: string, init?: RequestInit) => fetch(url, { cache: "no-store", ...init,
      headers: { ...init?.headers, "x-hh-expected-owner": userId ?? "" },
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]) });
    const seeRelease = (value: unknown) => {
      if (disposed || !isNewerRelease(value, RELEASE)) return;
      setUpdate(previous => !previous || value.builtAt > previous.builtAt ? value : previous);
    };
    async function loadHistory() {
      if (disposed || !userId) return;
      if (reading) { readAgain = true; return; }
      reading = true;
      try {
        const response = await request("/api/notifications");
        if (!response.ok) throw new Error("history");
        const result = await response.json();
        if (!disposed && Array.isArray(result.items)) setHistory({ owner: userId, items: result.items, error: null, loading: false });
      } catch {
        if (!disposed) setHistory(previous => ({ owner: userId, items: previous.owner === userId ? previous.items : [],
          error: "Your updates could not load. Try again.", loading: false }));
      } finally {
        reading = false;
        if (readAgain && !disposed) { readAgain = false; void loadHistory(); }
      }
    }
    async function checkRelease() {
      try { const response = await request("/api/release"); if (response.ok) seeRelease(await response.json()); } catch { /* Next visible check retries. */ }
    }
    function scheduleReconnect() {
      if (disposed || retry || document.visibilityState === "hidden" || !navigator.onLine) return;
      const delay = Math.min(30_000, 1000 * 2 ** Math.min(attempts++, 5)) + Math.random() * 500;
      retry = setTimeout(() => { retry = null; void connect(); }, delay);
    }
    async function connect() {
      if (disposed || connecting || socket || document.visibilityState === "hidden" || !navigator.onLine) return;
      connecting = true;
      try {
        const response = await request("/api/live-ticket", { method: "POST" });
        if (!response.ok) throw new Error("ticket");
        const result = await response.json();
        if (disposed || hidden()) return;
        const url = `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/api/live`;
        const ws = new WebSocket(url, ["hh-live", `ticket.${result.ticket}`]);
        socket = ws;
        ws.onopen = () => { if (disposed) { ws.close(); return; } attempts = 0; void checkRelease(); void loadHistory(); };
        ws.onmessage = event => {
          if (disposed || socket !== ws || typeof event.data !== "string" || event.data.length > 2048) return;
          try { const message = JSON.parse(event.data); if (message.type === "release") seeRelease(message.release);
            if (message.type === "inbox") void loadHistory(); } catch { /* Ignore unknown events. */ }
        };
        ws.onclose = () => { if (socket === ws) socket = null; scheduleReconnect(); };
        ws.onerror = () => ws.close();
      } catch { scheduleReconnect(); } finally { connecting = false; }
    }
    const disconnect = () => {
      if (retry) { clearTimeout(retry); retry = null; }
      if (socket) { const ws = socket; socket = null; ws.onclose = null; ws.close(); }
    };
    function resume() {
      if (document.visibilityState === "hidden" || !navigator.onLine) { disconnect(); return; }
      void checkRelease(); void loadHistory(); void connect();
    }
    refreshRef.current = () => { void loadHistory(); void checkRelease(); };
    markReadRef.current = async id => {
      if (disposed || !userId) return false;
      try {
        const response = await request("/api/notifications", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
        if (!response.ok || disposed) return false;
        await loadHistory(); return !disposed;
      } catch { return false; }
    };
    setHistory({ owner: userId, items: [], error: null, loading: !!userId });
    resume();
    // A missed database invalidation or a socket blocked by a proxy must
    // not leave a visible inbox or update prompt stale indefinitely.
    const reconcile = setInterval(resume, 60_000);
    document.addEventListener("visibilitychange", resume);
    window.addEventListener("online", resume);
    window.addEventListener("offline", disconnect);
    window.addEventListener("pageshow", resume);
    window.addEventListener("pagehide", disconnect);
    return () => {
      disposed = true; controller.abort(); disconnect(); clearInterval(reconcile);
      refreshRef.current = () => {}; markReadRef.current = async () => false;
      document.removeEventListener("visibilitychange", resume);
      window.removeEventListener("online", resume); window.removeEventListener("offline", disconnect);
      window.removeEventListener("pageshow", resume); window.removeEventListener("pagehide", disconnect);
    };
  }, [status, userId]);
  // Synchronous owner fence: never render A's history during the render
  // that observes B, even before the old effect cleans up.
  const current = status === "authenticated" && history.owner === userId;
  return <LiveContext.Provider value={{ items: current ? history.items : [], error: current ? history.error : null,
    loading: current ? history.loading : false, signedIn: status === "authenticated", update, refresh, markRead }}>{children}</LiveContext.Provider>;
}
