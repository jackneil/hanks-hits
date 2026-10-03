"use client";
import { useSyncExternalStore } from "react";
import { currentSessionUser, onSessionUser } from "../service/registry";
const serverSession = () => null;
/** Also works in the game runtime before a particular page mounts auth UI. */
export function useClipSession() {
  return useSyncExternalStore(onSessionUser, currentSessionUser, serverSession);
}
