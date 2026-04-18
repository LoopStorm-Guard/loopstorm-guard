// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Better Auth React client for the LoopStorm Guard web UI.
 *
 * This module creates the Better Auth client instance that communicates
 * with the backend's /api/auth/** endpoints.
 *
 * IMPORTANT: This is the ONLY auth mechanism. Never import from
 * @supabase/ssr, @supabase/supabase-js, or use Supabase Auth/GoTrue.
 * See ADR-011.
 *
 * The auth client is used in client components only ("use client").
 * For server-side session checking, fetch /api/auth/get-session directly
 * with the request cookies forwarded.
 */

import { createAuthClient } from "better-auth/react";
import { getAuthBaseURL } from "./env";

/**
 * The Better Auth React client instance.
 *
 * Exports:
 * - `signIn` — sign in with email/password or OAuth provider
 * - `signUp` — sign up with email/password
 * - `signOut` — sign out and clear session cookie
 * - `useSession` — React hook for current session state
 */
export const authClient = createAuthClient({
  baseURL: getAuthBaseURL(),
});

export const { signIn, signUp, signOut, useSession } = authClient;

/**
 * Request a password reset email.
 *
 * Better Auth v1.5.6 exposes this as a dynamic client method, but the
 * TypeScript types don't include it statically. We call $fetch directly
 * to keep the build type-safe.
 */
export async function forgetPassword({ email, redirectTo }: { email: string; redirectTo: string }) {
  return authClient.$fetch("/forget-password", {
    method: "POST",
    body: { email, redirectTo },
  });
}

/**
 * Reset the password using a token from the reset email link.
 */
export async function resetPassword({
  newPassword,
  token,
}: { newPassword: string; token: string }) {
  return authClient.$fetch("/reset-password", {
    method: "POST",
    body: { newPassword, token },
  });
}

/**
 * Ask the server to (re)send a verification email for the given address.
 * Rate limiting and abuse controls are enforced server-side (ADR-022 Layer 1
 * + the Hono per-email middleware). The UI always shows a generic success
 * message — never surface distinguishing errors to the DOM.
 */
export async function sendVerificationEmail({
  email,
  callbackURL,
}: { email: string; callbackURL?: string }) {
  return authClient.$fetch("/send-verification-email", {
    method: "POST",
    body: { email, callbackURL: callbackURL ?? "/onboarding" },
  });
}
