/**
 * /clips-lab: the clips A/V lab (plan 15.3).
 *
 * A dynamic server component. It reads CLIPS_LAB for each request, and it
 * answers 404 unless the value is exactly "1". connection() makes the route
 * dynamic, so a build never renders the page ahead of time: a production
 * server with no CLIPS_LAB always answers 404, whatever the build machine
 * had set. Test drivers start the server with CLIPS_LAB=1 (e2e/clips).
 */
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";

import { ClipsLabPage } from "@/shared/clips/lab/ClipsLab";
import { isClipsLabEnabled, parseLabParams } from "@/shared/clips/lab/labParams";

export const metadata: Metadata = {
  title: "Clips lab",
  robots: { index: false, follow: false },
};

export default async function ClipsLabRoute({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await connection();
  if (!isClipsLabEnabled(process.env)) notFound();
  const options = parseLabParams(await searchParams);
  return <ClipsLabPage options={options} />;
}
