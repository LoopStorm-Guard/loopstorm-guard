// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Per-IP and per-email rate limiting for Better Auth email-triggering
 * endpoints. Sits in front of Better Auth's own rate limiter (ADR-022 Layer 1)
 * to add the per-email dimension that Better Auth does not expose.
 *
 * Protected routes:
 *   - POST /api/auth/forget-password          (password-reset email)
 *   - POST /api/auth/send-verification-email  (resend verification email)
 *
 * Enforcement:
 *   - Per-IP:    `RATE_LIMIT_EMAIL_PER_HOUR` sends per hour (default 5).
 *   - Per-email: `RATE_LIMIT_EMAIL_PER_HOUR` sends per hour (default 5), and
 *                for the resend endpoint, 1 send per `RATE_LIMIT_RESEND_COOLDOWN_SECONDS`
 *                (default 60s) and `RATE_LIMIT_RESEND_PER_DAY` (default 5) per day.
 *   - Fail-closed: bucket store errors deny the request (auth path fails closed
 *                  per ADR-022 §Security Considerations).
 *
 * Per-request correlation: when a request passes rate limiting, the middleware
 * stores `{ ip, user_agent, nonce }` in an AsyncLocalStorage context so the
 * Better Auth `sendResetPassword` / `sendVerificationEmail` callbacks can
 * write the audit-log row tied to the same nonce.
 */

import type { Context, Next } from "hono";
import { emailRequestContext } from "../lib/request-context.js";
import { hashEmailKey, incrementBucket } from "../lib/rate-limit-store.js";
import { env } from "../env.js";

const FORGET_PASSWORD_PATH = "/api/auth/forget-password";
const SEND_VERIFICATION_PATH = "/api/auth/send-verification-email";

const RL_WINDOW_HOUR_SEC = 3600;
const RL_WINDOW_DAY_SEC = 86400;

interface EmailPayload {
  email?: unknown;
}

/**
 * Extract the trusted client IP, in Vercel-precedence order:
 *   x-vercel-forwarded-for > x-forwarded-for (first value) > unknown
 *
 * `x-forwarded-for` is attacker-controllable off-Vercel, but on Vercel it is
 * normalized by the edge. The raw header is the fallback for local dev only.
 */
function extractIp(c: Context): string {
  const vercel = c.req.header("x-vercel-forwarded-for");
  if (vercel) return vercel.split(",")[0]?.trim() || "unknown";
  const xff = c.req.header("x-forwarded-for");
  if (xff) return xff.split(",")[0]?.trim() || "unknown";
  return "unknown";
}

function respond429(c: Context, retryAfter: number): Response {
  c.header("Retry-After", String(retryAfter));
  return c.json({ error: "rate_limited", layer: "email", retryAfter }, 429);
}

/**
 * Hono middleware. Only fires on the two email-triggering auth routes; for
 * all other paths it falls through immediately.
 *
 * The request body is JSON; we parse it defensively and treat a missing email
 * as a pass-through (Better Auth will reject the malformed payload downstream).
 */
export async function emailRateLimit(c: Context, next: Next): Promise<Response | void> {
  const path = c.req.path;
  const isForget = path === FORGET_PASSWORD_PATH;
  const isResend = path === SEND_VERIFICATION_PATH;
  if (!isForget && !isResend) {
    return next();
  }
  if (c.req.method !== "POST") {
    return next();
  }

  // Clone the body so Better Auth's handler can still read it.
  let email = "";
  try {
    const raw = await c.req.raw.clone().json();
    const maybe = (raw as EmailPayload)?.email;
    if (typeof maybe === "string") email = maybe.trim().toLowerCase();
  } catch {
    // Malformed body — let Better Auth return its own 400.
    return next();
  }
  if (!email) {
    return next();
  }

  const ip = extractIp(c);
  const userAgent = (c.req.header("user-agent") ?? "").slice(0, 512);
  const endpointTag = isResend ? "resend" : "forget";

  const emailHash = await hashEmailKey(email);
  const perHour = env.RATE_LIMIT_EMAIL_PER_HOUR;

  // Per-IP: limits the damage a single attacker can do across many emails.
  const ipRes = await incrementBucket(`email:${endpointTag}:ip:${ip}`, RL_WINDOW_HOUR_SEC, perHour);
  if (!ipRes.allowed) return respond429(c, ipRes.retryAfter);

  // Per-email hourly: limits inbox spam for a single victim address.
  const addrHourRes = await incrementBucket(
    `email:${endpointTag}:addr:${emailHash}`,
    RL_WINDOW_HOUR_SEC,
    perHour
  );
  if (!addrHourRes.allowed) return respond429(c, addrHourRes.retryAfter);

  // Resend-only: 60s cooldown + daily cap.
  if (isResend) {
    const cooldownRes = await incrementBucket(
      `email:resend:cooldown:${emailHash}`,
      env.RATE_LIMIT_RESEND_COOLDOWN_SECONDS,
      1
    );
    if (!cooldownRes.allowed) return respond429(c, cooldownRes.retryAfter);

    const dailyRes = await incrementBucket(
      `email:resend:daily:${emailHash}`,
      RL_WINDOW_DAY_SEC,
      env.RATE_LIMIT_RESEND_PER_DAY
    );
    if (!dailyRes.allowed) return respond429(c, dailyRes.retryAfter);
  }

  // Attach request context for the Better Auth send callbacks to read.
  const nonce = crypto.randomUUID();
  return emailRequestContext.run({ ip, user_agent: userAgent, nonce }, () => next());
}
