import { NextRequest } from "next/server";

import { handlers } from "@/lib/auth";
import { readBody, refuseBody, SMALL_JSON_BODY } from "@/lib/read-body";

/**
 * The Auth.js routes (/api/auth/*).
 *
 * GET goes to Auth.js as it is: Next.js gives a GET handler no body.
 *
 * POST is wrapped. Auth.js reads the body itself (getBody in @auth/core:
 * req.json() or req.text()), with no size limit, before the CSRF check and
 * with no sign-in. This app has no middleware, and the Railway service
 * domain answers with no Cloudflare in front of it, so one large POST could
 * use all the memory of the server (a 300 MiB POST raised the server's RSS
 * to about 1.1 GB). The wrapper reads the body with the small JSON limits
 * (64 KiB in 30 s; a sign-in form is a few hundred bytes). Then it gives
 * Auth.js a new request with the same bytes and the same headers, so Auth.js
 * works as before: CSRF, sign-in, sign-out and the callbacks. A refused
 * body writes one log line with no value in it (a 413 here is a sign of an
 * attack).
 */
export const { GET } = handlers;

export async function POST(incoming: NextRequest): Promise<Response> {
  const read = await readBody(incoming, SMALL_JSON_BODY);
  if (!read.ok) return refuseBody("POST /api/auth/[...nextauth]", read, incoming);
  return handlers.POST(
    new NextRequest(incoming.url, {
      method: "POST",
      headers: incoming.headers,
      // Always the bytes, also when there are none. Next.js gives an empty
      // POST an empty body stream (not null), and Auth.js answers an empty
      // JSON body with 400 from that stream. A null body here would change
      // the answer.
      body: read.bytes as BodyInit,
    })
  );
}
