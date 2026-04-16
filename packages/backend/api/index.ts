// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Vercel Function entry point for the LoopStorm Guard API.
 *
 * Bridges the Vercel Node.js runtime (which calls handlers with a Node.js
 * IncomingMessage / ServerResponse pair) to Hono's fetch-based API (which
 * expects Web API Request / Response objects).
 *
 * We cannot use `hono/vercel`'s `handle()` here — that adapter is a one-liner
 * `(req) => app.fetch(req)` designed for Edge Runtime, where Vercel passes a
 * Web API Request. In Node.js runtime, Vercel passes an IncomingMessage, so
 * `headers.get` crashes immediately in CORS middleware.
 *
 * Runtime: nodejs20.x (declared in vercel.json).
 * Region: iad1 (us-east-1 — matches Supabase region).
 *
 * See ADR-015 for the full deployment architecture and migration rationale.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { app } from "../src/app.js";

export const config = {
  runtime: "nodejs",
};

function nodeRequestToWebRequest(req: IncomingMessage): Request {
  const host = req.headers.host ?? "localhost";
  const proto = (req.headers["x-forwarded-proto"] as string | undefined) ?? "https";
  const url = `${proto}://${host}${req.url ?? "/"}`;

  const headers = new Headers();
  for (const [key, val] of Object.entries(req.headers)) {
    if (val == null) continue;
    headers.set(key, Array.isArray(val) ? val.join(", ") : val);
  }

  const method = req.method ?? "GET";
  const hasBody = method !== "GET" && method !== "HEAD";

  const bodyInit = hasBody
    ? new ReadableStream({
        start(controller) {
          req.on("data", (chunk: Buffer) => controller.enqueue(new Uint8Array(chunk)));
          req.on("end", () => controller.close());
          req.on("error", (err: Error) => controller.error(err));
        },
      })
    : null;

  const init: RequestInit = { method, headers, body: bodyInit };
  // Node.js 18+ fetch requires duplex:"half" for streaming request bodies.
  // Not in the TS lib types yet, so we assign it after construction.
  if (hasBody) (init as Record<string, unknown>).duplex = "half";
  return new Request(url, init);
}

// Headers with the non-standard but widely-supported getSetCookie() method
// (WHATWG spec, available in Node.js 19.7+ / undici).
type HeadersWithGetSetCookie = Headers & { getSetCookie?(): string[] };

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const webRequest = nodeRequestToWebRequest(req);
  const webResponse = await app.fetch(webRequest);

  res.statusCode = webResponse.status;

  // set-cookie must be handled separately — headers.forEach collapses
  // multiple values into a single comma-joined string, which produces an
  // invalid header and breaks Better Auth session/CSRF cookies.
  const setCookies = (webResponse.headers as HeadersWithGetSetCookie).getSetCookie?.() ?? [];
  if (setCookies.length > 0) {
    res.setHeader("set-cookie", setCookies);
  }
  webResponse.headers.forEach((value, key) => {
    if (key.toLowerCase() === "set-cookie") return;
    res.setHeader(key, value);
  });

  // Stream the body rather than buffering the whole payload in memory.
  if (webResponse.body) {
    const readable = Readable.fromWeb(webResponse.body as import("node:stream/web").ReadableStream);
    readable.on("error", (err) => {
      console.error("[handler] response stream error:", err);
      if (!res.headersSent) res.statusCode = 502;
      res.end();
    });
    readable.pipe(res);
  } else {
    res.end();
  }
}
