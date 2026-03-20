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
 * - `getSession` — imperative session fetch
 */
export const authClient = createAuthClient({
  baseURL: getAuthBaseURL(),
});

export const { signIn, signUp, signOut, useSession } = authClient;
