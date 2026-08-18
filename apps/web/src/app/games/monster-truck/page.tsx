"use client";

import dynamic from "next/dynamic";

const MonsterTruckGameShell = dynamic(() => import("@/games/monster-truck/GameShell"), { ssr: false });

export default function MonsterTruckPage() {
  return <MonsterTruckGameShell />;
}
