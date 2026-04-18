// SPDX-License-Identifier: AGPL-3.0-only
/**
 * AsyncLocalStorage bridge between Hono middleware and Better Auth callbacks.
 *
 * Better Auth's `sendResetPassword` / `sendVerificationEmail` callbacks do not
 * receive the originating HTTP request, so there is no direct way to correlate
 * the send with the IP / User-Agent / rate-limit row that was created for the
 * request. We wrap the Better Auth handler in an ALS context and read the
 * stored values from inside the callbacks.
 */

import { AsyncLocalStorage } from "node:async_hooks";

export interface EmailRequestContext {
  /** Trusted client IP, extracted from x-vercel-forwarded-for / x-forwarded-for. */
  ip: string;
  /** User-Agent header value, truncated to avoid unbounded writes. */
  user_agent: string;
  /** Random per-request nonce; used to correlate middleware audit rows with the Resend send. */
  nonce: string;
}

export const emailRequestContext = new AsyncLocalStorage<EmailRequestContext>();
