// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Better Auth configuration for LoopStorm Guard.
 *
 * Auth strategy (ADR-011):
 * - Email + password with email verification required
 * - Google OAuth (optional, only enabled when GOOGLE_CLIENT_ID/SECRET are set)
 * - Custom session plugin that injects `tenant_id` into the session object
 *   so every authenticated request has a tenant context
 *
 * NEVER use Supabase Auth / GoTrue. All auth flows through Better Auth.
 *
 * The drizzleAdapter maps Better Auth's internal table/column names to our
 * snake_case schema. Better Auth v1.2.x uses camelCase internally but the
 * adapter accepts a `map` option to rename columns.
 *
 * Session data flow:
 * 1. User logs in via email+password or Google OAuth.
 * 2. Better Auth creates/updates the session row.
 * 3. Our `onSessionCreated` hook looks up the user's `tenant_id` from the
 *    users table and stores it on the session row.
 * 4. The session token is returned to the client as a cookie.
 * 5. On each request, `auth.api.getSession()` returns the session including
 *    our `tenant_id` field.
 * 6. The tRPC auth middleware reads `session.user.tenant_id` and sets the
 *    PostgreSQL RLS context.
 */

import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db } from "./db/client.js";
import { env } from "./env.js";
import * as schema from "./db/schema.js";

// Build social providers config only when OAuth credentials are present.
// This lets local development work without OAuth credentials.
const socialProviders: Parameters<typeof betterAuth>[0]["socialProviders"] =
  env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
    ? {
        google: {
          clientId: env.GOOGLE_CLIENT_ID,
          clientSecret: env.GOOGLE_CLIENT_SECRET,
        },
      }
    : {};

export const auth = betterAuth({
  // Use the postgres-js Drizzle instance as the database adapter.
  // provider: "pg" maps to the postgres.js / pg-core dialect.
  database: drizzleAdapter(db, {
    provider: "pg",
    // Map Better Auth's expected table/column names to our schema.
    // Better Auth v1.2.x expects: user, session, account, verification
    // Our tables are: users, sessions, accounts, verifications
    schema: {
      user: schema.users,
      session: schema.sessions,
      account: schema.accounts,
      verification: schema.verifications,
    },
  }),

  // Base URL for auth routes (used in email links, OAuth redirects)
  baseURL: env.BETTER_AUTH_URL,

  // Secret for signing session tokens and JWTs
  secret: env.BETTER_AUTH_SECRET,

  emailAndPassword: {
    // Enable email+password authentication
    enabled: true,
    // Require email verification before the account can be used.
    // Better Auth will send a verification email on registration.
    requireEmailVerification: true,
  },

  socialProviders,

  session: {
    // Cache sessions in a cookie for 5 minutes to reduce DB lookups.
    // The cookie stores the session token; the DB is the source of truth.
    cookieCache: {
      enabled: true,
      maxAge: 60 * 5, // 5 minutes in seconds
    },
  },

  // The `user` object returned by getSession() will include any extra
  // columns on the users table. Since we added `tenant_id` to the users
  // table, it will be present in session.user after the user's record
  // is updated with their tenant ID (done in the registration endpoint).
  //
  // See: packages/backend/src/trpc/routers/auth-hooks.ts (future step)
  // for the post-registration hook that creates the tenant and sets tenant_id.
});

/**
 * The auth instance type, exported for use in middleware and tests.
 */
export type Auth = typeof auth;
