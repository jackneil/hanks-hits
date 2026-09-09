"use client";

import dynamic from "next/dynamic";

const FourWheeler3dGameShell = dynamic(
  () => import("@/games/four-wheeler-3d/GameShell"),
  { ssr: false }
);

export default function FourWheeler3dPage() {
  return <FourWheeler3dGameShell />;
}
