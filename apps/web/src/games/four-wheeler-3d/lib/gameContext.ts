"use client";

/**
 * The one place the scene shares live values that change every frame.
 *
 * A React context holding refs, never state: the vehicle writes the player
 * position into a ref each frame and the chunk streamer reads it. Nothing
 * re-renders because of it, which is what keeps the frame budget.
 */

import { createContext, useCallback, useContext, useMemo, useRef } from "react";
import * as THREE from "three";

/** Where the rider starts: in front of the garage, facing the yard. */
export const SPAWN: readonly [number, number, number] = [-400, 3, 12];

export type GameContextValue = {
  /** The player position, written by the vehicle every frame. */
  playerPos: React.RefObject<THREE.Vector3>;
  /** Which way the player faces, written by the vehicle every frame. */
  playerQuat: React.RefObject<THREE.Quaternion>;
  /** How fast the player is going, in meters per second. */
  playerSpeedRef: React.RefObject<number>;
  /** Read how many terrain chunks are loaded, for the development counter. */
  getLoadedChunks: () => number;
  /** Report how many terrain chunks are loaded. */
  setLoadedChunks: (count: number) => void;
};

const GameContext = createContext<GameContextValue | null>(null);

/** Build the shared refs once per mounted game. */
export function useCreateGameContext(): GameContextValue {
  const playerPos = useRef(new THREE.Vector3(SPAWN[0], SPAWN[1], SPAWN[2]));
  const playerQuat = useRef(new THREE.Quaternion());
  const playerSpeedRef = useRef(0);
  const loadedChunks = useRef(0);

  const getLoadedChunks = useCallback(() => loadedChunks.current, []);
  const setLoadedChunks = useCallback((count: number) => {
    loadedChunks.current = count;
  }, []);

  return useMemo(
    () => ({
      playerPos,
      playerQuat,
      playerSpeedRef,
      getLoadedChunks,
      setLoadedChunks,
    }),
    [getLoadedChunks, setLoadedChunks],
  );
}

export const GameContextProvider = GameContext.Provider;

/** Read the shared refs. Throws if something renders outside the game. */
export function useGameContext(): GameContextValue {
  const value = useContext(GameContext);
  if (!value) {
    throw new Error("useGameContext must be used inside the game scene");
  }
  return value;
}
