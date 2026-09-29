"use client";

import { SessionProvider } from "next-auth/react";
import { ReactNode } from "react";
// A direct import, not the clips barrel: the watcher module holds no clip
// code, so the root layout stays free of the barrel's modules.
import { ClipSessionWatcher } from "@/shared/clips/service/ClipSessionWatcher";

type AuthProviderProps = {
  children: ReactNode;
};

/**
 * Auth context provider - wraps the app with NextAuth session
 *
 * Add this to layout.tsx to enable auth throughout the app
 *
 * ClipSessionWatcher tells gameplay clips who is signed in, on every page,
 * so clips always go to the right player's shelf (it renders nothing).
 */
export function AuthProvider({ children }: AuthProviderProps) {
  return (
    <SessionProvider>
      <ClipSessionWatcher />
      {children}
    </SessionProvider>
  );
}

export default AuthProvider;
