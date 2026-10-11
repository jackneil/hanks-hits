import { NextResponse } from "next/server";
import { RELEASE } from "@/lib/live/release";
export const dynamic = "force-dynamic";
export function GET() {
  return NextResponse.json(RELEASE, { headers: { "Cache-Control": "no-store" } });
}
