"use client";

/**
 * The clip viewer (plan 11.4, 12): a sheet at z-2500, full screen on phones
 * and a dialog on wider screens. It shows one clip, or the list of one
 * game's clips ("My clips from this game").
 *
 * One clip:
 * - Plays the clip (a video element on the stored file), or shows the picture.
 * - Share calls service.share() SYNCHRONOUSLY inside the tap (the browser
 *   needs the user activation). The file is read and named once, when the
 *   clip opens, so it is ready before the tap, and every tap hands the
 *   service the SAME File object: the service tells a Screen Time or Family
 *   Link block from a missed tap by a second refusal of the same file.
 *   Each ShareOutcome gets its plan 12 reply.
 * - Share shows only where the browser has a share sheet (plan 12: none in
 *   Firefox on a computer or Chrome on Linux), and goes away when the
 *   service says the browser cannot share.
 * - "Save to Photos" (iPhone and iPad: the share sheet, with a picture of
 *   the Save Video button for the first shares), "Save to phone" (Android)
 *   or "Save to computer" (everything else). On an iPhone or iPad, when the
 *   share sheet cannot take the clip (too big, or no share sheet), the
 *   button becomes "Save to Files" and copies the file to the device, so
 *   the kid always has a way to get the clip out. Every reply names the
 *   button that is on screen.
 * - Keep / Kept, and Delete with a question first.
 * - A clip that lives only in memory (a private window) shows a sticky note:
 *   share it or copy it to the device now.
 * - A clip whose file cannot be read says so, and keeps Delete, so a broken
 *   clip never stays in the list for good.
 * - Opening a clip marks it watched, so the new-clip chip goes away.
 * - Failures log a values-free reason (plan 12).
 *
 * The game pauses before the viewer opens, where it can: the controller does
 * that (controller.openViewer), so every way in behaves the same.
 */

import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";

import type { ClipRecord } from "../protocol";
import { useClipService } from "../service/context";
import type { ShareOutcome } from "../service/contract";
import { useClipUi } from "./uiContext";
import {
  DELETE_QUESTIONS,
  SAVE_BUTTON_LABELS,
  VIEWER_COPY,
  VIEWER_TITLES,
  memoryNote,
  saveReply,
  shareReply,
  type SaveButton,
  type SavePlatform,
} from "./copy";
import { ClipTile } from "./ClipTile";
import { clipGameInfo, formatDuration } from "./format";
import { KeepGlyph, SaveGlyph, ShareGlyph, TrashGlyph } from "./glyphs";
import { logClipUiFailure } from "./log";
import { canShareHere, subscribeToNothing } from "./platform";
import { Sheet } from "./Sheet";
import { SHARE_COACH_TIMES, type ViewerTarget } from "./uiStore";

export interface ClipViewerProps {
  target: ViewerTarget;
  onClose: () => void;
}

type ViewState = { kind: "clip"; id: string; fromGame: string | null } | { kind: "game"; gameId: string };

interface LoadedMedia {
  id: string;
  /** The stored file under its plan 12 name. The same object for every Share and Save tap. */
  file: File;
  url: string;
}

/** What the share sheet said about one clip. */
interface ShareTrouble {
  id: string;
  /** The share sheet cannot take this file (fallback-save). */
  rejected: boolean;
  /** This browser cannot share at all (unsupported). */
  unsupported: boolean;
}

const ACTION = "btn h-auto min-h-14 w-full gap-2 px-4 py-2 text-lg font-semibold normal-case whitespace-normal touch-manipulation";

function initialView(target: ViewerTarget): ViewState {
  return target.kind === "clip" ? { kind: "clip", id: target.id, fromGame: null } : target;
}

function newestFirst(a: ClipRecord, b: ClipRecord): number {
  return b.createdAt - a.createdAt;
}

/**
 * The "Save to ..." button on screen. On an iPhone or iPad it is "Save to
 * Photos" (the share sheet) while the share sheet can take the clip, and
 * "Save to Files" (a copy to the device) when it cannot.
 */
function saveButtonFor(platform: SavePlatform, shareUsable: boolean): SaveButton {
  if (platform === "photos") return shareUsable ? "photos" : "files";
  return platform;
}

/** The trouble a share outcome leaves behind, or null when there is none. */
function troubleFor(outcome: ShareOutcome["kind"], id: string, before: ShareTrouble | null): ShareTrouble | null {
  const rejected = outcome === "fallback-save" || (before?.rejected ?? false);
  const unsupported = outcome === "unsupported" || (before?.unsupported ?? false);
  return rejected || unsupported ? { id, rejected, unsupported } : before;
}

export function ClipViewer({ target, onClose }: ClipViewerProps) {
  const ui = useClipUi();
  const service = useClipService();
  const browserCanShare = useSyncExternalStore(subscribeToNothing, () => canShareHere(), () => false);
  const [view, setView] = useState<ViewState>(() => initialView(target));
  const [records, setRecords] = useState<ClipRecord[] | null>(null);
  const [media, setMedia] = useState<LoadedMedia | null>(null);
  const [mediaFailedId, setMediaFailedId] = useState<string | null>(null);
  const [status, setStatus] = useState<{ id: string; text: string } | null>(null);
  const [saveHighlightId, setSaveHighlightId] = useState<string | null>(null);
  const [shareTrouble, setShareTrouble] = useState<ShareTrouble | null>(null);
  const [keptOverride, setKeptOverride] = useState<Record<string, boolean>>({});
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // Load the library, and follow changes from any tab.
  useEffect(() => {
    if (!service) return;
    let alive = true;
    const load = () => {
      service.library.list().then(
        (list) => {
          if (alive) setRecords(list);
        },
        (error: unknown) => {
          logClipUiFailure("list", error);
          if (alive) setRecords([]);
        },
      );
    };
    load();
    const unsubscribe = service.library.subscribe(load);
    return () => {
      alive = false;
      unsubscribe();
    };
  }, [service]);

  const record = view.kind === "clip" && records ? (records.find((item) => item.id === view.id) ?? null) : null;
  const recordId = record?.id ?? null;
  const recordWatched = record?.watched ?? null;

  // The newest record, for the load effect and the tap handlers (they run after render).
  const recordRef = useRef<ClipRecord | null>(record);
  useLayoutEffect(() => {
    recordRef.current = record;
  });

  // Read and name the stored file once per clip. The share tap then has it
  // ready, and every tap passes the same File.
  useEffect(() => {
    if (!service || !recordId) return;
    let alive = true;
    let url: string | null = null;
    service.library.file(recordId).then(
      (stored) => {
        if (!alive) return;
        const current = recordRef.current;
        let file = stored;
        if (current && current.id === recordId) {
          try {
            file = new File([stored], service.fileNameFor(current), { type: current.mime, lastModified: current.createdAt });
          } catch (error) {
            logClipUiFailure("name", error);
          }
        }
        url = typeof URL.createObjectURL === "function" ? URL.createObjectURL(file) : "";
        setMedia({ id: recordId, file, url });
      },
      (error: unknown) => {
        logClipUiFailure("read", error);
        if (alive) setMediaFailedId(recordId);
      },
    );
    return () => {
      alive = false;
      if (url && typeof URL.revokeObjectURL === "function") URL.revokeObjectURL(url);
    };
  }, [service, recordId]);

  // Opening a clip marks it watched: the new-clip chip goes away.
  useEffect(() => {
    if (!service || !recordId) return;
    service.markWatched(recordId);
    if (recordWatched === false) {
      service.library.markWatched(recordId).catch((error: unknown) => {
        // The row changes again on the next open. Nothing for the kid to do.
        logClipUiFailure("mark watched", error);
      });
    }
  }, [service, recordId, recordWatched]);

  if (!ui || !service) return null;

  const platform = ui.platform();
  const readyMedia = media && recordId && media.id === recordId ? media : null;
  const statusText = status && status.id === recordId ? status.text : null;
  const showStatus = (text: string | null) => {
    if (text && recordId) setStatus({ id: recordId, text });
  };
  const trouble = shareTrouble && shareTrouble.id === recordId ? shareTrouble : null;
  const shareShown = browserCanShare && !trouble?.unsupported;
  const saveButtonKind = saveButtonFor(platform, shareShown && !trouble?.rejected);
  const kind = record?.kind ?? "clip";

  const coachSaveVideo = saveButtonKind === "photos" && ui.store.sharesCoached() < SHARE_COACH_TIMES;

  const onShare = () => {
    const file = readyMedia?.file;
    const id = recordId;
    if (!file || !id) return;
    // Synchronously inside the tap: the share sheet needs the user activation.
    let pending: Promise<ShareOutcome>;
    try {
      pending = service.share(file);
    } catch (error) {
      pending = Promise.reject(error);
    }
    if (coachSaveVideo) ui.store.noteShareCoached();
    const answer = (outcome: ShareOutcome["kind"]) => {
      const next = troubleFor(outcome, id, trouble);
      if (next !== trouble) setShareTrouble(next);
      if (outcome === "fallback-save" || outcome === "unsupported") setSaveHighlightId(id);
      const nextShareShown = browserCanShare && !next?.unsupported;
      const nextSave = saveButtonFor(platform, nextShareShown && !next?.rejected);
      showStatus(shareReply(outcome, nextSave, kind));
    };
    pending.then(
      (outcome) => {
        if (outcome.kind !== "shared" && outcome.kind !== "cancelled") logClipUiFailure("share", undefined, outcome.kind);
        answer(outcome.kind);
      },
      (error: unknown) => {
        // A share that throws is treated like a file the share sheet cannot take.
        logClipUiFailure("share", error);
        answer("fallback-save");
      },
    );
  };

  const onSave = () => {
    // On an iPhone, the way into Photos is the share sheet's Save Video.
    if (saveButtonKind === "photos") {
      onShare();
      return;
    }
    const file = readyMedia?.file;
    if (!file) return;
    const save = saveButtonKind;
    service.saveToDevice(file).then(
      (outcome) => {
        if (outcome.kind === "failed") logClipUiFailure("save", undefined, outcome.reason);
        showStatus(saveReply(outcome, save, kind));
      },
      (error: unknown) => {
        logClipUiFailure("save", error);
        showStatus(saveReply({ kind: "failed", reason: "unknown" }, save, kind));
      },
    );
  };

  const isKept = record ? (keptOverride[record.id] ?? record.kept) : false;
  const onKeep = () => {
    if (!record) return;
    const id = record.id;
    const next = !isKept;
    setKeptOverride((map) => ({ ...map, [id]: next }));
    service.library.setKept(id, next).catch((error: unknown) => {
      logClipUiFailure("keep", error);
      setKeptOverride((map) => ({ ...map, [id]: !next }));
    });
  };

  const onDelete = () => {
    if (!record) return;
    const id = record.id;
    const back = view.kind === "clip" ? view.fromGame : null;
    setConfirmDeleteId(null);
    service.library.remove(id).then(
      () => {
        if (back) setView({ kind: "game", gameId: back });
        else onClose();
      },
      (error: unknown) => {
        logClipUiFailure("delete", error);
        showStatus(VIEWER_COPY.deleteFailed);
      },
    );
  };

  // ----- The list of one game's clips -----
  if (view.kind === "game") {
    const list = records ? records.filter((item) => item.gameId === view.gameId).sort(newestFirst) : null;
    const empty = list !== null && list.length === 0;
    const readAloud = () =>
      [
        VIEWER_COPY.gameListTitle,
        clipGameInfo(view.gameId).name,
        empty ? `${VIEWER_COPY.gameListEmptySay} ${VIEWER_COPY.gameListEmptyNext}` : null,
      ]
        .filter(Boolean)
        .join(". ");
    return (
      <Sheet title={VIEWER_COPY.gameListTitle} variant="full" testId="clip-viewer" onClose={onClose} readAloudText={readAloud}>
        <p className="mb-3 text-base font-semibold text-base-content/80">{clipGameInfo(view.gameId).name}</p>
        {list === null && <p className="py-8 text-center text-lg">{VIEWER_COPY.loading}</p>}
        {empty && (
          <div data-testid="clip-viewer-empty" className="flex flex-col items-center gap-2 py-10 text-center">
            <p className="text-lg font-semibold">{VIEWER_COPY.gameListEmptySay}</p>
            <p className="text-base">{VIEWER_COPY.gameListEmptyNext}</p>
          </div>
        )}
        {list && list.length > 0 && (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {list.map((item) => (
              <li key={item.id} className="min-w-0">
                <ClipTile record={item} onOpen={() => setView({ kind: "clip", id: item.id, fromGame: view.gameId })} />
              </li>
            ))}
          </ul>
        )}
      </Sheet>
    );
  }

  // ----- One clip -----
  const loadingList = records === null;
  const missing = !loadingList && !record;
  const broken = record !== null && mediaFailedId === record.id;
  const title = record ? VIEWER_TITLES[record.kind] : VIEWER_TITLES.clip;
  const game = clipGameInfo(record?.gameId);
  const isPicture = record ? record.kind === "picture" || record.mime === "image/png" : false;
  const saveLabel = SAVE_BUTTON_LABELS[saveButtonKind];
  // A computer saves first (plan 12); without a share sheet, Save is the only way out.
  const saveFirst = platform === "computer" || !shareShown;
  const inMemory = record?.storage === "memory";
  const note = inMemory ? memoryNote(saveButtonKind, shareShown) : null;
  const confirming = record !== null && confirmDeleteId === record.id;
  const fromGame = view.fromGame;

  const readAloud = () => {
    if (missing) return [title, VIEWER_COPY.missingSay, VIEWER_COPY.missingNext].join(". ");
    const confirmWords = confirming && record ? [DELETE_QUESTIONS[record.kind], VIEWER_COPY.deleteYes, VIEWER_COPY.deleteNo] : null;
    if (broken) {
      return [title, game.name, VIEWER_COPY.brokenSay, VIEWER_COPY.brokenNext, statusText, ...(confirmWords ?? [VIEWER_COPY.delete])]
        .filter(Boolean)
        .join(". ");
    }
    const buttons = !shareShown ? [saveLabel] : saveFirst ? [saveLabel, VIEWER_COPY.share] : [VIEWER_COPY.share, saveLabel];
    return [
      title,
      game.name,
      note,
      statusText,
      ...(confirmWords ?? [...buttons, isKept ? VIEWER_COPY.kept : VIEWER_COPY.keep, VIEWER_COPY.delete]),
    ]
      .filter(Boolean)
      .join(". ");
  };

  const shareButton = shareShown ? (
    <button
      key="share"
      type="button"
      data-action="share"
      data-autofocus={saveFirst ? undefined : "true"}
      disabled={!readyMedia}
      onClick={onShare}
      className={`${ACTION} ${saveFirst ? "border-base-300 bg-base-100" : "btn-primary"}`}
    >
      <ShareGlyph />
      {VIEWER_COPY.share}
    </button>
  ) : null;
  const highlightSave = saveFirst || saveHighlightId === recordId;
  const saveButton = (
    <button
      key="save"
      type="button"
      data-action="save"
      data-save={saveButtonKind}
      data-autofocus={saveFirst ? "true" : undefined}
      disabled={!readyMedia}
      onClick={onSave}
      className={`${ACTION} ${highlightSave ? "btn-primary" : "border-base-300 bg-base-100"}`}
    >
      <SaveGlyph />
      {saveLabel}
    </button>
  );

  const deleteButton = (
    <button
      type="button"
      data-action="delete"
      disabled={!record}
      onClick={() => record && setConfirmDeleteId(record.id)}
      className={`${ACTION} border-base-300 bg-base-100`}
    >
      <TrashGlyph />
      {VIEWER_COPY.delete}
    </button>
  );

  const confirmBlock =
    confirming && record ? (
      <div data-testid="clip-viewer-confirm" className="flex flex-col gap-2 rounded-xl bg-base-200 p-3">
        <p className="text-lg font-semibold">{DELETE_QUESTIONS[record.kind]}</p>
        <button type="button" data-action="delete-yes" onClick={onDelete} className={`${ACTION} btn-error`}>
          <TrashGlyph />
          {VIEWER_COPY.deleteYes}
        </button>
        <button
          type="button"
          data-action="delete-no"
          data-autofocus="true"
          onClick={() => setConfirmDeleteId(null)}
          className={`${ACTION} border-base-300 bg-base-100`}
        >
          {VIEWER_COPY.deleteNo}
        </button>
      </div>
    ) : null;

  return (
    <Sheet title={title} variant="full" testId="clip-viewer" onClose={onClose} readAloudText={readAloud}>
      {note && !broken && (
        <p
          role="note"
          data-testid="clip-viewer-memory-note"
          className="sticky top-0 z-10 mb-3 rounded-xl bg-amber-100 px-4 py-3 text-base font-semibold text-amber-950"
        >
          {note}
        </p>
      )}

      {fromGame && (
        <button
          type="button"
          onClick={() => setView({ kind: "game", gameId: fromGame })}
          className="btn btn-ghost mb-2 h-11 min-h-11 self-start px-3 text-base normal-case"
        >
          {VIEWER_COPY.backToList}
        </button>
      )}

      <p data-testid="clip-viewer-game" className="mb-2 flex min-w-0 items-center gap-2 text-base font-semibold">
        <span aria-hidden="true">{game.emoji}</span>
        <span className="truncate">{game.name}</span>
        {record && !isPicture && !broken && (
          <span className="ml-auto shrink-0 tabular-nums text-base-content/70">{formatDuration(record.durationMs / 1000)}</span>
        )}
      </p>

      {missing ? (
        <div data-testid="clip-viewer-missing" className="flex flex-col items-center gap-2 py-10 text-center">
          <p className="text-lg font-semibold">{VIEWER_COPY.missingSay}</p>
          <p className="text-base">{VIEWER_COPY.missingNext}</p>
        </div>
      ) : (
        <>
          {broken ? (
            <div data-testid="clip-viewer-broken" className="mb-3 flex flex-col items-center gap-2 py-8 text-center">
              <p className="text-lg font-semibold">{VIEWER_COPY.brokenSay}</p>
              <p className="text-base">{VIEWER_COPY.brokenNext}</p>
            </div>
          ) : (
            <div className="mb-3 flex min-h-40 items-center justify-center overflow-hidden rounded-xl bg-slate-950">
              {readyMedia && record ? (
                isPicture ? (
                  // A blob: URL of the kid's own picture; next/image adds nothing here.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    data-testid="clip-viewer-picture"
                    src={readyMedia.url}
                    alt={`${title}: ${game.name}`}
                    className="max-h-[50dvh] w-full object-contain"
                  />
                ) : (
                  <video
                    data-testid="clip-viewer-video"
                    src={readyMedia.url}
                    poster={record.posterDataUrl || undefined}
                    controls
                    playsInline
                    preload="metadata"
                    aria-label={`${title}: ${game.name}`}
                    className="max-h-[50dvh] w-full bg-black object-contain"
                  />
                )
              ) : (
                <p className="px-4 py-12 text-center text-lg text-white">{VIEWER_COPY.loading}</p>
              )}
            </div>
          )}

          <p role="status" aria-live="polite" data-testid="clip-viewer-status" className="mb-2 min-h-6 text-center text-base font-semibold">
            {statusText}
          </p>

          {confirmBlock ??
            (broken ? (
              <div className="flex flex-col gap-2">{deleteButton}</div>
            ) : (
              <div className="flex flex-col gap-2 sm:grid sm:grid-cols-2">
                {saveFirst ? [saveButton, shareButton] : [shareButton, saveButton]}
                {coachSaveVideo && (
                  <p data-testid="clip-viewer-coach" className="flex items-center gap-3 rounded-xl bg-base-200 px-4 py-2 text-base sm:col-span-2">
                    <span className="min-w-0 flex-1">{VIEWER_COPY.photosCoach}</span>
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-base-100 text-primary">
                      <SaveGlyph size={26} />
                    </span>
                  </p>
                )}
                <button
                  type="button"
                  data-action="keep"
                  aria-pressed={isKept}
                  disabled={!record}
                  onClick={onKeep}
                  className={`${ACTION} ${isKept ? "btn-neutral" : "border-base-300 bg-base-100"}`}
                >
                  <KeepGlyph filled={isKept} />
                  {isKept ? VIEWER_COPY.kept : VIEWER_COPY.keep}
                </button>
                {deleteButton}
              </div>
            ))}
        </>
      )}
    </Sheet>
  );
}
