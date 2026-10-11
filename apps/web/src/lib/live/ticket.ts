import { createHmac, timingSafeEqual } from "node:crypto";

export type LiveTicket = { userId: string | null; expires: number };
const sign = (body: string, secret: string) => createHmac("sha256", secret).update(`hh-live-v1:${body}`).digest("base64url");

export function issueLiveTicket(userId: string | null, secret: string, now = Date.now()): string {
  const body = Buffer.from(JSON.stringify({ userId, expires: now + 60_000 })).toString("base64url");
  return `${body}.${sign(body, secret)}`;
}

export function verifyLiveTicket(ticket: string, secret: string, now = Date.now()): LiveTicket | null {
  if (!secret || ticket.length > 2048) return null;
  const parts = ticket.split(".");
  if (parts.length !== 2) return null;
  const [body, signature] = parts;
  const expected = Buffer.from(sign(body, secret));
  const actual = Buffer.from(signature);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  try {
    const data = JSON.parse(Buffer.from(body, "base64url").toString()) as LiveTicket;
    if (data.userId !== null && (typeof data.userId !== "string" || !data.userId || data.userId.length > 200)) return null;
    if (!Number.isSafeInteger(data.expires) || data.expires <= now || data.expires > now + 60_000) return null;
    return data;
  } catch { return null; }
}
