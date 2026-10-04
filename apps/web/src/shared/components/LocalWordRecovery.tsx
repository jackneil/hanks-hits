"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode, type Ref } from "react";
import { createPortal } from "react-dom";
import { useSession } from "next-auth/react";
import { localWords, type WordAppId, type WordEdit } from "@/lib/local-words";
import { ownerBoundProgress } from "@/lib/owner-bound-progress";
import { subscribeWordRecovery, wordRecoveryActions, wordRecoverySynced } from "@/shared/lib/localWordRecovery";

import { useShellOverlay } from "@/shared/lib/shellOverlays";
import { useSecondFingerClick } from "@/shared/lib/input";

const buttonClass = "min-h-11 min-w-11 rounded-lg bg-blue-700 py-2 font-bold text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700";

function RecoveryButton({ children, onPress, disabled = false, expanded, label, buttonRef, compact = false }: { children: ReactNode; onPress: () => void; disabled?: boolean; expanded?: boolean; label?: string; buttonRef?: Ref<HTMLButtonElement>; compact?: boolean }) {
  const handlers = useSecondFingerClick<HTMLButtonElement>(() => { if (!disabled) onPress(); });
  return <button ref={buttonRef} aria-label={label} className={`${buttonClass} ${compact ? "w-20 shrink-0 px-2 text-sm" : "px-4"}`} type="button" disabled={disabled} aria-expanded={expanded} {...handlers}>{children}</button>;
}
const fieldLabels: Record<string, string> = {
  leaderName: "Wagon leader", partyNames: "Travelers", name: "Name", savedLocations: "Saved places",
  lastLocation: "Last place", notes: "Toy note", artwork: "Drawing", text: "Outfit text", label: "Feeder label",
};
function place(value: unknown): string {
  if (!value || typeof value !== "object") return "No place selected";
  const location = value as { name?: string; admin1?: string; country?: string };
  return [location.name, location.admin1, location.country].filter(Boolean).join(", ");
}
function PreviewValue({ edit }: { edit: WordEdit }) {
  if (edit.field === "artwork" && edit.value && typeof edit.value === "object") {
    const artwork = edit.value as { name?: string; thumbnail?: string };
    return <>{artwork.name || "Saved drawing"}{typeof artwork.thumbnail === "string" && /^data:image\/(png|jpeg|webp);base64,/.test(artwork.thumbnail)
      // Local validated pixels, never a remote URL or active image format.
      // eslint-disable-next-line @next/next/no-img-element
      && <img className="mt-2 max-h-32 rounded-lg" src={artwork.thumbnail} alt={artwork.name || "Saved drawing preview"} />}</>;
  }
  if (edit.field === "savedLocations" && Array.isArray(edit.value)) return <ul>{edit.value.map((value, index) => <li key={index}>{place(value)}</li>)}</ul>;
  if (edit.field === "lastLocation") return <>{place(edit.value)}</>;
  if (Array.isArray(edit.value)) return <ul>{edit.value.map((value, index) => <li key={index}>{typeof value === "string" ? value || "(cleared)" : "Saved item"}</li>)}</ul>;
  return <>{typeof edit.value === "string" ? edit.value || "(cleared)" : "(cleared)"}</>;
}
/** Validated candidate text stays in this DOM surface, outside game capture. */
function Preview({ edits }: { edits: readonly WordEdit[] }) {
  return <ul className="space-y-2 break-words">{edits.map((edit, index) => <li key={index}>
    <span className="font-semibold">{fieldLabels[edit.field] ?? "Saved words"}: </span><PreviewValue edit={edit} />
  </li>)}</ul>;
}

/** Local loading and recovery never hold the gameplay hydration gate open. */
export function LocalWordRecovery({ appId, inHeader = false }: { appId: WordAppId; inHeader?: boolean }) {
  const { data, status } = useSession();
  const snapshot = useSyncExternalStore(localWords.subscribe, localWords.getSnapshot, localWords.getSnapshot);
  const lease = snapshot.status === "ready" ? localWords.captureLease() : null;
  const canonical = useSyncExternalStore(subscribeWordRecovery,
    () => wordRecoverySynced(appId, lease), () => false);
  const [recovery, setRecovery] = useState<"loading" | "ready" | "unavailable">("loading");
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [retry, setRetry] = useState(0);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const visible = !!lease && ownerBoundProgress.matchesSession(status, data?.user?.id);
  useShellOverlay(expanded && visible);
  useEffect(() => {
    if (!expanded || !visible) return;
    const trigger = triggerRef.current;
    closeRef.current?.focus();
    return () => { if (trigger?.isConnected) trigger.focus(); };
  }, [expanded, visible]);
  const [chosen, setChosen] = useState<ReadonlySet<string>>(new Set());

  useEffect(() => {
    const captured = localWords.captureLease();
    const userId = data?.user?.id;
    if (!captured || !ownerBoundProgress.matchesSession(status, userId)) return;
    let active = true;
    setBusy(false); setMessage(""); setChosen(new Set()); setRecovery(userId ? "loading" : "ready");
    void localWords.prepare(appId, captured);
    if (status === "authenticated" && userId) {
      void localWords.recover(appId, userId, captured).then(result => {
        if (active && localWords.isCurrent(captured)) setRecovery(result === "unavailable" ? "unavailable" : "ready");
      });
    }
    return () => { active = false; };
  }, [appId, snapshot.ownerKey, snapshot.generation, status, data?.user?.id, retry]);

  useEffect(() => { setExpanded(false); }, [appId, snapshot.ownerKey, snapshot.generation]);
  const failed = snapshot.apps[appId].status === "memory-only";

  if (!lease || !ownerBoundProgress.matchesSession(status, data?.user?.id) || typeof document === "undefined") return null;
  const app = snapshot.apps[appId];
  const actions = wordRecoveryActions(appId);
  const candidates = localWords.candidates(appId, lease).flatMap(source => {
    if (source.ownerKey !== lease.ownerKey) return [];
    const choices = actions?.candidateChoices?.(source);
    if (choices?.length) return choices.filter(choice => choice.edits.length).map((choice, index) => ({
      source, edits: choice.edits, unmatched: false, label: choice.label, key: JSON.stringify([source.id, index]),
    }));
    const matched = actions?.mapCandidate(source);
    const edits = matched ?? (actions?.confirmUnmatched ? actions.previewCandidate?.(source) : null);
    return edits?.length ? [{ source, edits, unmatched: !matched, label: "", key: source.id }] : [];
  }).filter(candidate => !chosen.has(candidate.key));
  const pending = app.status === "idle" || app.status === "loading" || app.pendingWrites;

  const retrySaving = async () => {
    setBusy(true);
    try { await localWords.retry(lease, appId); }
    finally { if (localWords.isCurrent(lease)) { setBusy(false); setRetry(value => value + 1); } }
  };
  const choose = async (candidate: typeof candidates[number]) => {
    if (!localWords.isCurrent(lease)) return;
    setBusy(true); setMessage("");
    try {
      const result = candidate.unmatched
        ? await actions?.confirmUnmatched?.(candidate.source, lease)
        : await localWords.commitCandidate(appId, candidate.source.id, candidate.edits, lease, "confirmed-choice");
      if (!localWords.isCurrent(lease)) return;
      if (result === "durable") {
        closeRef.current?.focus();
        setChosen(previous => new Set([...previous, candidate.key]));
        setMessage("Your selected words are saved on this device.");
      } else setMessage("Your choice could not be saved on this device. Keep this page open and retry.");
    } catch {
      if (localWords.isCurrent(lease)) setMessage("Your choice could not be saved on this device. Keep this page open and retry.");
    } finally { if (localWords.isCurrent(lease)) setBusy(false); }
  };

  const label = failed ? "Words need saving" : pending ? "Words loading or saving" : "Saved words";
  return <>
    <RecoveryButton buttonRef={triggerRef} compact={inHeader} label={`${label}${candidates.length ? ` (${candidates.length})` : ""}`} expanded={expanded} onPress={() => setExpanded(true)}>{failed || recovery === "unavailable" ? "Words!" : "Words"}</RecoveryButton>
    {!expanded && <span role="status" className="sr-only">{failed ? "Words need saving. Open Words to retry." : pending ? "Loading or saving words on this device. You can keep playing." : "Your words stay on this device."}</span>}
    {expanded && createPortal(<div className="fixed inset-0 z-[2500] flex overflow-y-auto bg-black/70 p-3" onKeyDown={event => {
      event.stopPropagation();
      if (event.key === "Escape") { event.preventDefault(); setExpanded(false); }
      if (event.key === "Tab") {
        const buttons = Array.from(panelRef.current?.querySelectorAll<HTMLButtonElement>("button:not([disabled])") ?? []);
        if (!buttons.length) return;
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
        event.preventDefault();
        buttons[index < 0 ? (event.shiftKey ? buttons.length - 1 : 0) : (index + (event.shiftKey ? buttons.length - 1 : 1)) % buttons.length].focus();
      }
    }}>
    <div ref={panelRef} role="dialog" aria-modal="true" aria-label="Words saved on this device" className="m-auto w-full max-w-xl rounded-xl border border-slate-300 bg-white p-3 text-sm text-slate-950 shadow-xl">
      <RecoveryButton buttonRef={closeRef} onPress={() => setExpanded(false)}>Keep playing</RecoveryButton>
      <p className="mt-2 font-bold">Words saved on this device</p>
      <div role="status" aria-live="polite" className="mt-2">
        {failed ? <p>This device could not finish saving or recovering your words. Keep this page open and retry. You can keep playing.</p>
          : pending ? <p>Loading or saving words on this device. You can keep playing.</p> : null}
        {recovery === "unavailable" && <p>Older words from your account could not be checked. Your game can still save.</p>}
        {message && <p>{message}</p>}
      </div>
      <div className="mt-2 space-y-3">
        {(failed || recovery === "unavailable") && <RecoveryButton disabled={busy} onPress={() => void retrySaving()}>Retry</RecoveryButton>}
        {!candidates.length && !pending && !failed && <p>New names, notes, and drawings you save here stay on this device.</p>}
        {!!candidates.length && <>
          <p>Choose a saved version to use on this device. This replaces the matching words. Other versions stay available.</p>
          <ol className="space-y-4">{candidates.map((candidate, index) => <li className="border-t border-slate-300 pt-3" key={candidate.key}>
            <p className="mb-2 font-bold">Saved version {index + 1}</p>{candidate.label && <p>{candidate.label}</p>}<Preview edits={candidate.edits} />
            {candidate.unmatched && !canonical && <p>Wait for account progress to finish syncing before choosing journey names.</p>}
            <div className="mt-2"><RecoveryButton disabled={busy || candidate.unmatched && !canonical} onPress={() => void choose(candidate)}>Use saved version {index + 1}</RecoveryButton></div>
          </li>)}</ol>
        </>}
      </div>
    </div>
    </div>, document.body)}
  </>;
}
