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
 * 3. Our `databaseHooks.user.create.after` hook fires after user insertion.
 *    It creates a tenant row and back-fills tenant_id on both the user row
 *    and any active sessions (so the first session is not left without a
 *    tenant, which would cause all tRPC protectedProcedure calls to FORBIDDEN).
 * 4. The session token is returned to the client as a cookie.
 * 5. On each request, `auth.api.getSession()` returns the session including
 *    our `tenant_id` field.
 * 6. The tRPC auth middleware reads `session.user.tenant_id` and sets the
 *    PostgreSQL RLS context.
 */

import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { eq } from "drizzle-orm";
import { db } from "./db/client.js";
import { sessions, tenants, users } from "./db/schema.js";
import * as schema from "./db/schema.js";
import { env } from "./env.js";

// ---------------------------------------------------------------------------
// Post-registration tenant creation
// ---------------------------------------------------------------------------

/**
 * Derives a URL-safe tenant slug from a user's email address.
 *
 * Algorithm:
 * 1. Take the local part (before @).
 * 2. Lowercase and replace all non-alphanumeric characters with hyphens.
 * 3. Collapse consecutive hyphens, trim leading/trailing hyphens.
 * 4. Append a random 4-character alphanumeric suffix to avoid collisions.
 *
 * Example: "Alice.Smith+tag@example.com" → "alice-smith-tag-a3f9"
 */
function deriveSlug(email: string): string {
  const local = email.split("@")[0] ?? email;
  const base = local
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40); // cap length before suffix
  // 4-char alphanumeric suffix: use crypto.getRandomValues for randomness.
  // 4 bytes → 4 chars, each mapped to base-36 (0-9 + a-z).
  const suffix = Array.from(crypto.getRandomValues(new Uint8Array(4)))
    .map((b) => (b % 36).toString(36))
    .join("");
  return `${base}-${suffix}`;
}

/**
 * Creates a tenant for a newly registered user and back-fills tenant_id on
 * both the user row and any active sessions.
 *
 * Called from `databaseHooks.user.create.after`. Errors here are logged but
 * not re-thrown — a failed tenant creation should not block the auth response.
 * The user can still authenticate; a support workflow can fix the missing
 * tenant. Future improvement: wrap in a retry or saga.
 */
async function provisionTenantForUser(user: {
  id: string;
  name: string;
  email: string;
}): Promise<void> {
  const tenantName = user.name.trim() || user.email;
  const slug = deriveSlug(user.email);

  // Insert the tenant row. If the slug collides (extremely unlikely due to
  // the random suffix), Postgres will throw and the catch block will log it.
  const [newTenant] = await db
    .insert(tenants)
    .values({
      name: tenantName,
      slug,
      plan: "free",
      is_active: true,
    })
    .returning({ id: tenants.id });

  if (!newTenant) {
    throw new Error("Tenant insert returned no rows — database error");
  }

  const tenantId = newTenant.id;

  // Back-fill tenant_id on the user row. Better Auth has already committed
  // the user row before this hook fires, so a direct UPDATE is correct.
  await db.update(users).set({ tenant_id: tenantId }).where(eq(users.id, user.id));

  // Back-fill tenant_id on any sessions that were created in the same
  // registration flow (Better Auth may create a session immediately on
  // email+password signup if requireEmailVerification is false, or on
  // OAuth where the provider implicitly verifies the email).
  // This prevents the first request after sign-up from hitting FORBIDDEN.
  await db.update(sessions).set({ tenant_id: tenantId }).where(eq(sessions.user_id, user.id));
}

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

  // Post-registration hook: create a tenant for every new user.
  //
  // Better Auth fires `databaseHooks.user.create.after` after the user row
  // is committed. We use this to provision a tenant row and back-fill
  // tenant_id on users + sessions so the first authenticated request works.
  //
  // The `user` object matches the Better Auth internal user shape. Our
  // additional `tenant_id` column is not present yet (it is set by the hook),
  // so we only access the guaranteed fields: id, name, email.
  databaseHooks: {
    user: {
      create: {
        after: async (user) => {
          try {
            await provisionTenantForUser({
              id: user.id,
              // Better Auth's internal user type uses `name` (may be empty
              // string for some OAuth providers — deriveSlug handles that).
              name: user.name ?? "",
              email: user.email,
            });
          } catch (err) {
            // Log but do not re-throw. A failed tenant provision should not
            // surface as an auth error to the user. Ops can repair via SQL.
            console.error("[auth] provisionTenantForUser failed:", err);
          }
        },
      },
    },
  },
});

/**
 * The auth instance type, exported for use in middleware and tests.
 */
export type Auth = typeof auth;
