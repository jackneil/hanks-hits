"use client";

/**
 * The clip tile: the one signature layout primitive of the clip surfaces
 * (plan 11.4). The viewer's list uses it now; My Clips and the shelves use
 * it later. One look everywhere: the poster, the length, a "New" mark for a
 * clip the kid has not watched, and a filled ribbon for a kept clip.
 *
 * A clip with no poster, or whose game the library does not know (gameId
 * "unknown"), gets the generic picture and name. It never throws.
 */

import type { ClipRecord } from "../protocol";
import { tileName, VIEWER_COPY } from "./copy";
import { clipGameInfo, formatDuration } from "./format";
import { KeepGlyph } from "./glyphs";

export interface ClipTileProps {
  record: ClipRecord;
  onOpen: () => void;
}

export function ClipTile({ record, onOpen }: ClipTileProps) {
  const game = clipGameInfo(record.gameId);
  const isPicture = record.kind === "picture" || record.mime === "image/png";
  const length = isPicture ? null : formatDuration(record.durationMs / 1000);
  const poster = typeof record.posterDataUrl === "string" && record.posterDataUrl.startsWith("data:image/")
    ? record.posterDataUrl
    : null;

  return (
    <button
      type="button"
      data-testid="clip-tile"
      data-clip-id={record.id}
      data-known-game={game.known ? "true" : "false"}
      onClick={onOpen}
      aria-label={tileName(game.name, record.kind, length)}
      className="flex w-full min-w-0 flex-col overflow-hidden rounded-xl bg-base-200 text-left touch-manipulation active:scale-[0.98] transition-transform"
    >
      <span className="relative block aspect-video w-full bg-slate-900">
        {poster ? (
          // A data: URL made on this device; next/image adds nothing here.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={poster} alt="" className="h-full w-full object-cover" draggable={false} />
        ) : (
          <span data-testid="clip-tile-generic" className="flex h-full w-full items-center justify-center text-4xl" aria-hidden="true">
            {game.emoji}
          </span>
        )}
        {!record.watched && (
          <span className="absolute left-2 top-2 rounded-md bg-white px-2 py-0.5 text-xs font-bold text-slate-900">
            {VIEWER_COPY.newMark}
          </span>
        )}
        {record.kept && (
          <span className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-md bg-white text-slate-900">
            <KeepGlyph size={16} filled />
          </span>
        )}
        {length && (
          <span className="absolute bottom-2 right-2 rounded-md bg-slate-900 px-1.5 py-0.5 text-xs font-semibold tabular-nums text-white">
            {length}
          </span>
        )}
      </span>
      <span className="block min-w-0 truncate px-2 py-1.5 text-sm font-semibold" aria-hidden="true">
        {game.name}
      </span>
    </button>
  );
}
