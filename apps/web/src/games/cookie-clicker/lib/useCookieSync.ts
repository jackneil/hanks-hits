"use client";

import { useMemo, useState } from "react";
import type { ContinuationContext, ProgressContinuation } from "@/shared/lib/progressContinuation";
import { sameProgress } from "@/shared/lib/progressStamp";
import { BakerySyncSession, BAKERY_JOURNAL_PREFIX, isBakerySnapshot,
  parseBakeryJournal, type BakeryJournal, type BakerySnapshot } from "./sync-session";
import { useCookieClickerStore, type CookieClickerProgress } from "./store";

type RecoveryChoice = { label: string; data: CookieClickerProgress };
export type BakerySyncView = {
  conflict: BakerySnapshot | null;
  choices: RecoveryChoice[];
  storageAvailable: boolean;
  error: boolean;
  busy: boolean;
};
const emptyView: BakerySyncView = { conflict: null, choices: [], storageAvailable: true, error: false, busy: false };
const progress = () => useCookieClickerStore.getState().getProgress();

/** Update persisted fields without ending frenzy or discarding a golden cookie. */
function applyProgress(data: CookieClickerProgress): void {
  if (sameProgress(progress(), data)) return;
  useCookieClickerStore.setState(data);
  const store = useCookieClickerStore.getState();
  useCookieClickerStore.setState({ cookiesPerSecond: store.calculateCps(), cookiesPerClick: store.calculateClickPower() });
}

class CookieContinuation implements ProgressContinuation<CookieClickerProgress> {
  private session: BakerySyncSession | null = null;
  private context: ContinuationContext<CookieClickerProgress> | null = null;
  private flight: Promise<{ ok: boolean; status: number | null }> | null = null;
  private originals = new Map<string, number>();
  private choices: RecoveryChoice[] = [];
  private error = false;
  private alive = true;
  get active(): boolean { return this.alive && this.session !== null; }
  deactivate(): void { this.alive = false; }

  constructor(private readonly notify: (view: BakerySyncView) => void) {}

  private availableChoices(): RecoveryChoice[] {
    const backup = this.session?.snapshot().choiceBackup?.live;
    return backup ? [...this.choices, { label: "Bakery before your choice", data: backup }] : this.choices;
  }

  private publish(): void {
    this.notify({ conflict: this.session?.snapshot().conflict ?? null, choices: this.availableChoices(),
      storageAvailable: this.session?.storageAvailable ?? true, error: this.error, busy: this.flight !== null });
  }

  private canonical(context: ContinuationContext<CookieClickerProgress>): BakerySnapshot | null {
    return context.canonical.protocol === 1 && isBakerySnapshot(context.canonical) ? context.canonical : null;
  }

  private install(context: ContinuationContext<CookieClickerProgress>, journal: BakeryJournal): void {
    this.alive = true;
    this.context = context;
    this.session = new BakerySyncSession(journal, {
      maySave: () => this.alive && this.context === context && context.maySave(),
      persist: (key, raw) => localStorage.setItem(key, raw),
      requestId: () => crypto.randomUUID(),
    });
    this.session.capture(journal.live);
    this.publish();
  }

  begin(context: ContinuationContext<CookieClickerProgress>, related: boolean): void {
    if (this.active || !context.maySave()) return;
    const canonical = this.canonical(context);
    if (!canonical) return; // An old server cannot support this protocol.
    this.install(context, {
      version: 1, ownerId: context.ownerId, writerId: crypto.randomUUID(), acknowledged: canonical,
      sent: null, live: context.live, conflict: related ? null : canonical,
      resolving: false, choiceBackup: null,
    });
  }

  recover(context: ContinuationContext<CookieClickerProgress>): boolean {
    if (this.active) return true;
    const canonical = this.canonical(context);
    if (!canonical || !context.maySave()) return false;
    const journals: BakeryJournal[] = [];
    const found: Array<{ key: string; raw: string; row: BakeryJournal }> = [];
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (!key?.startsWith(BAKERY_JOURNAL_PREFIX) || !key.endsWith("-storage")) continue;
        const raw = localStorage.getItem(key);
        const row = raw ? parseBakeryJournal(raw, context.ownerId) : null;
        if (row) found.push({ key, raw: raw!, row });
      }
    } catch {
      // The game remains usable. begin/capture exposes any persistence failure.
      return false;
    }
    const resolved = found.flatMap(({ row }) => row.resolvedCopies ?? []);
    for (const { key, row } of found) {
      if (resolved.some(([oldKey, serial]) => oldKey === key && serial === (row.serial ?? 0))) continue;
      if (!row.sent && !row.conflict && (sameProgress(row.live, row.acknowledged.data) ||
          (row.acknowledged.data === null && row.live.lastModified <= 0))) continue;
      journals.push(row);
      this.originals.set(key, row.serial ?? 0);
    }
    if (!journals.length) return false;
    const only = journals.length === 1 && sameProgress(journals[0].live, context.live) ? journals[0] : null;
    if (only) {
      this.install(context, { ...only, writerId: crypto.randomUUID() });
      const request = this.session!.prepare(context.live);
      if (request) this.session!.receive(request, canonical, false, context.live);
      this.publish();
      return true;
    }
    // Separate tabs may have independent purchases. Keep every unresolved
    // journal and the actual gameplay save available for an explicit choice.
    this.choices = journals.flatMap((row, index) => [
      { label: `Recovered bakery ${index + 1}`, data: row.live },
      ...(row.choiceBackup ? [{ label: `Bakery before choice ${index + 1}`, data: row.choiceBackup.live }] : []),
    ]);
    this.begin(context, false);
    return true;
  }

  observeOtherTab(): void {
    // A timestamp-newer tab is not an acknowledged cloud revision. Preserve
    // this tab's live state; its next conditional write detects cloud changes.
    this.session?.capture(progress());
    this.publish();
  }

  async save(data: CookieClickerProgress): Promise<{ ok: boolean; status: number | null }> {
    if (!this.active || !this.session || !this.context?.maySave()) return { ok: false, status: null };
    this.session.capture(data);
    if (this.flight) return this.flight;
    const request = this.session.prepare(data);
    if (!request) {
      this.publish();
      return { ok: !this.session.snapshot().conflict, status: this.session.snapshot().conflict ? 409 : 200 };
    }
    const session = this.session, context = this.context;
    this.flight = (async () => {
      try {
        const response = await fetch("/api/progress/cookie-clicker", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ data: request.data, merge: true,
            baseRevision: request.base.revision, expectedOwnerId: context.ownerId }),
        });
        if (!this.alive || this.context !== context || !context.maySave()) return { ok: false, status: response.status };
        const body: unknown = await response.json();
        if (!this.alive || this.context !== context || !context.maySave()) return { ok: false, status: response.status };
        if ((response.ok || response.status === 409) && isBakerySnapshot(body)) {
          const outcome = session.receive(request, body, response.ok, progress());
          if (outcome === "saved") {
            applyProgress(session.snapshot().live);
            this.error = false;
            this.choices = [];
            // Exact-copy receipts cannot erase work that another tab adds
            // between a getItem and removeItem. Changed records still recover.
            session.retire([...this.originals]);
            this.originals.clear();
            return { ok: true, status: response.status };
          }
          this.error = outcome === "retry";
          return { ok: false, status: response.status };
        }
        this.error = true;
        return { ok: false, status: response.status };
      } catch {
        this.error = true;
        return { ok: false, status: null };
      } finally {
        this.flight = null;
        if (this.alive && this.context === context && context.maySave()) this.publish();
      }
    })();
    this.publish();
    return this.flight;
  }

  flush(data: CookieClickerProgress): void {
    if (!this.context?.maySave()) return;
    const request = this.session?.prepare(data);
    if (!request) return;
    const payload = JSON.stringify({ data: request.data, merge: true,
      baseRevision: request.base.revision, expectedOwnerId: this.context.ownerId });
    try { navigator.sendBeacon("/api/progress/cookie-clicker", new Blob([payload], { type: "application/json" })); }
    catch { /* The immutable request stays durable for retry after reload. */ }
  }

  async choose(displayed: BakerySnapshot, selected: "local" | "server" | number): Promise<void> {
    if (!this.session || !this.context?.maySave() || this.flight) return;
    const local = progress();
    this.session.capture(local);
    const choices = this.availableChoices();
    const data = selected === "local" ? local : selected === "server" ? displayed.data : choices[selected]?.data;
    if (!data || !this.session.choose(displayed, data, choices.map((choice) => choice.data))) return;
    applyProgress(this.session.snapshot().live);
    this.publish();
    await this.save(progress());
  }
}

export function useCookieSync() {
  const [view, setView] = useState<BakerySyncView>(emptyView);
  const continuation = useMemo(() => new CookieContinuation(setView), []);
  return { continuation, view,
    choose: (snapshot: BakerySnapshot, selected: "local" | "server" | number) => continuation.choose(snapshot, selected),
    retry: () => continuation.save(progress()) };
}
