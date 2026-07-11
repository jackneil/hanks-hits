"use client";
import dynamic from "next/dynamic";

const OregonTrailGameShell = dynamic(
  () => import("@/games/oregon-trail/OregonTrailGameShell"),
  { ssr: false }
);

export default function OregonTrailPage() {
  return <OregonTrailGameShell />;
}
