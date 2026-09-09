"use client";

/**
 * Keeps the ground loaded around the player and lets the rest go.
 *
 * A 7 x 7 window of 128 m chunks follows the rider, which is 49 chunks and
 * about 450 m of ground in every direction. The far fog hides the edge. This
 * is a streaming window, not a limit on the world: a chunk that scrolls out
 * comes straight back, built from the same seeded functions, when the player
 * rides that way again.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";

import { CHUNK_VIEW_RADIUS, WORLD } from "../lib/constants";
import { chunkCoordsFor, chunkKey } from "../lib/terrain";
import { useGameContext } from "../lib/gameContext";
import { TerrainChunk } from "./TerrainChunk";

/** The chunk coordinates the world actually covers. */
const MIN_CHUNK = -Math.floor(WORLD.CHUNKS / 2);
const MAX_CHUNK = Math.ceil(WORLD.CHUNKS / 2) - 1;

/** Only look at the player's chunk every few frames. It changes rarely. */
const CHECK_EVERY = 8;

function clampChunk(value: number): number {
  return Math.min(MAX_CHUNK, Math.max(MIN_CHUNK, value));
}

export function ChunkStreamer() {
  const { playerPos, setLoadedChunks } = useGameContext();
  const start = chunkCoordsFor(playerPos.current.x, playerPos.current.z);
  const [center, setCenter] = useState(start);
  const frame = useRef(0);

  const chunks = useMemo(() => {
    const out: Array<{ cx: number; cz: number; key: string }> = [];
    for (let dx = -CHUNK_VIEW_RADIUS; dx <= CHUNK_VIEW_RADIUS; dx++) {
      for (let dz = -CHUNK_VIEW_RADIUS; dz <= CHUNK_VIEW_RADIUS; dz++) {
        const cx = center.cx + dx;
        const cz = center.cz + dz;
        if (cx < MIN_CHUNK || cx > MAX_CHUNK) continue;
        if (cz < MIN_CHUNK || cz > MAX_CHUNK) continue;
        out.push({ cx, cz, key: chunkKey(cx, cz) });
      }
    }
    return out;
  }, [center]);

  // The development counter reads this ref, so it is written after render.
  useEffect(() => {
    setLoadedChunks(chunks.length);
  }, [chunks, setLoadedChunks]);

  useFrame(() => {
    frame.current = (frame.current + 1) % CHECK_EVERY;
    if (frame.current !== 0) return;
    const player = playerPos.current;
    const next = chunkCoordsFor(player.x, player.z);
    const cx = clampChunk(next.cx);
    const cz = clampChunk(next.cz);
    if (cx !== center.cx || cz !== center.cz) setCenter({ cx, cz });
  });

  return (
    <group>
      {chunks.map((chunk) => (
        <TerrainChunk key={chunk.key} cx={chunk.cx} cz={chunk.cz} />
      ))}
    </group>
  );
}

export default ChunkStreamer;
