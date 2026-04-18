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
import { Resend } from "resend";
import { db } from "./db/client.js";
import { emailAuditLog, sessions, tenants, users } from "./db/schema.js";
import * as schema from "./db/schema.js";
import { env } from "./env.js";
import { emailRequestContext } from "./lib/request-context.js";

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

// ---------------------------------------------------------------------------
// Resend email client (optional — only when RESEND_API_KEY is configured)
// ---------------------------------------------------------------------------

/**
 * Resend client for transactional email delivery.
 *
 * Null when RESEND_API_KEY is not set. Auth email handlers (verification,
 * password reset) check for null and log a warning instead of throwing.
 * This preserves Mode 0 (air-gapped) compatibility — no email is required
 * for the engine to function offline.
 */
const resend = env.RESEND_API_KEY ? new Resend(env.RESEND_API_KEY) : null;

const FROM_ADDRESS = "LoopStorm Guard <noreply@loop-storm.com>";

// ---------------------------------------------------------------------------
// Email audit log (ADR-021 abuse detection)
//
// Every Resend send is bracketed by a row in `email_audit_log`:
//   1. INSERT `{ send_status: 'pending', ip, user_agent, request_nonce }`
//   2. `resend.emails.send(...)`
//   3. UPDATE to `'sent'` with the Resend message id, or `'failed'` on throw.
//
// The `ip`, `user_agent`, `request_nonce`, and `user_id` fields come from the
// AsyncLocalStorage context attached by the email-rate-limit middleware. When
// the callback is invoked outside that middleware (e.g., Better Auth's own
// email-on-signup path) the context is undefined and those fields are null.
// ---------------------------------------------------------------------------

type EmailAuditType = "password_reset" | "verification" | "resend_verification";

// Resend's `emails.send()` resolves to `{ data, error }`, not a raw id. The
// helper accepts that exact shape so callers can pass the Resend call straight
// through without unwrapping.
interface ResendSendResult {
  data: { id?: string } | null;
  error: unknown;
}

async function logEmailSend(params: {
  email: string;
  userId: string | null;
  emailType: EmailAuditType;
  send: () => Promise<ResendSendResult>;
}): Promise<void> {
  const ctx = emailRequestContext.getStore();
  const nonce = ctx?.nonce ?? crypto.randomUUID();

  // Resolve tenant_id from the user row so the audit row is visible under the
  // tenant-isolation RLS policy. Null is fine for sends before a tenant is
  // provisioned (e.g., during the sign-up verification email). DB failure here
  // is non-fatal — we just skip populating the field.
  let tenantId: string | null = null;
  if (params.userId) {
    try {
      const [row] = await db
        .select({ tenant_id: users.tenant_id })
        .from(users)
        .where(eq(users.id, params.userId));
      tenantId = row?.tenant_id ?? null;
    } catch (err) {
      console.warn("[auth] tenant lookup for audit row failed:", err);
    }
  }

  // Step 1: pending row so the send is observable even if the process dies.
  try {
    await db.insert(emailAuditLog).values({
      user_id: params.userId,
      tenant_id: tenantId,
      email: params.email,
      email_type: params.emailType,
      ip: ctx?.ip ?? null,
      user_agent: ctx?.user_agent ?? null,
      send_status: "pending",
      request_nonce: nonce,
    });
  } catch (err) {
    // Audit-log write failures must not block the send (observability is
    // non-critical; rate-limit enforcement already ran).
    console.warn("[auth] email audit log insert failed:", err);
  }

  // Step 2 + 3: send, then update status.
  let result: ResendSendResult;
  try {
    result = await params.send();
  } catch (err) {
    try {
      await db
        .update(emailAuditLog)
        .set({ send_status: "failed" })
        .where(eq(emailAuditLog.request_nonce, nonce));
    } catch (auditErr) {
      console.warn("[auth] email audit log update (failed) failed:", auditErr);
    }
    throw err;
  }

  // Resend reports provider-side failures via `result.error` rather than
  // throwing. Treat those the same as a thrown error for audit purposes.
  if (result.error) {
    try {
      await db
        .update(emailAuditLog)
        .set({ send_status: "failed" })
        .where(eq(emailAuditLog.request_nonce, nonce));
    } catch (auditErr) {
      console.warn("[auth] email audit log update (failed) failed:", auditErr);
    }
    console.error("[auth] resend returned error:", result.error);
    return;
  }

  try {
    await db
      .update(emailAuditLog)
      .set({ send_status: "sent", resend_message_id: result.data?.id ?? null })
      .where(eq(emailAuditLog.request_nonce, nonce));
  } catch (err) {
    console.warn("[auth] email audit log update (sent) failed:", err);
  }
}

// ---------------------------------------------------------------------------
// Social providers
// ---------------------------------------------------------------------------

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
  // Trusted origins for cross-origin requests (Better Auth CSRF check).
  //
  // Better Auth v1.x validates the Origin header on every state-mutating
  // request. Without this, all cross-origin auth calls from app.loop-storm.com
  // to api.loop-storm.com are rejected with a CORS/403 error even when the
  // Hono CORS middleware is correctly configured.
  //
  // Mirrors the fallback logic in app.ts so both the Hono CORS middleware and
  // Better Auth's internal CSRF check share the same effective origin list:
  // - Production: ALLOWED_ORIGINS (required — server won't boot without it)
  // - Development (ALLOWED_ORIGINS unset): falls back to http://localhost:3000
  trustedOrigins:
    env.ALLOWED_ORIGINS.length > 0
      ? env.ALLOWED_ORIGINS
      : env.NODE_ENV === "production"
        ? []
        : ["http://localhost:3000"],

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

  // ---------------------------------------------------------------------------
  // Field name mappings: Better Auth uses camelCase internally; our Drizzle
  // schema uses snake_case JavaScript property names. Without these mappings
  // the adapter throws "field X does not exist in the Y Drizzle schema".
  // ---------------------------------------------------------------------------

  user: {
    fields: {
      emailVerified: "email_verified",
      createdAt: "created_at",
      updatedAt: "updated_at",
    },
  },

  account: {
    fields: {
      accountId: "account_id",
      providerId: "provider_id",
      userId: "user_id",
      accessToken: "access_token",
      refreshToken: "refresh_token",
      idToken: "id_token",
      accessTokenExpiresAt: "access_token_expires_at",
      refreshTokenExpiresAt: "refresh_token_expires_at",
      createdAt: "created_at",
      updatedAt: "updated_at",
    },
  },

  verification: {
    fields: {
      expiresAt: "expires_at",
      createdAt: "created_at",
      updatedAt: "updated_at",
    },
  },

  // ADR-022 Layer 1 — Better Auth built-in rate limiter (per-IP). This caps
  // the IP dimension for all auth endpoints; the per-email dimension is added
  // by the Hono `emailRateLimit` middleware in app.ts. Fail-closed:
  // rate-limited requests return 429 before reaching the Resend client.
  rateLimit: {
    enabled: true,
    window: 60,
    max: 10,
    storage: "database",
    customRules: {
      "/sign-in/email": { window: 60, max: 10 },
      "/sign-up/email": { window: 3600, max: 20 },
      "/forget-password": { window: 3600, max: env.RATE_LIMIT_EMAIL_PER_HOUR },
      "/send-verification-email": { window: 3600, max: env.RATE_LIMIT_EMAIL_PER_HOUR },
      "/verify-email": { window: 3600, max: env.RATE_LIMIT_EMAIL_PER_HOUR },
    },
  },

  emailAndPassword: {
    // Enable email+password authentication
    enabled: true,
    // Only require email verification when Resend is configured.
    // If RESEND_API_KEY is absent the verification email is never sent, which
    // permanently locks newly-registered users out of their accounts.
    requireEmailVerification: !!env.RESEND_API_KEY,
    sendResetPassword: async ({ user, url }) => {
      if (!resend) {
        console.warn("[auth] RESEND_API_KEY not set — password reset email disabled");
        return;
      }
      await logEmailSend({
        email: user.email,
        userId: user.id,
        emailType: "password_reset",
        send: () =>
          resend.emails.send({
            from: FROM_ADDRESS,
            to: user.email,
            subject: "Reset your LoopStorm Guard password",
            html: `<p>Click the link below to reset your password. This link expires in 1 hour.</p><p><a href="${url}">Reset Password</a></p><p>If you did not request a password reset, you can ignore this email.</p>`,
          }),
      });
    },
  },

  emailVerification: {
    // Send a verification email on every new sign-up.
    // Better Auth calls sendVerificationEmail with a signed URL that the user
    // clicks to verify their address before they can log in.
    sendOnSignUp: true,
    sendVerificationEmail: async ({ user, url }) => {
      if (!resend) {
        console.warn("[auth] RESEND_API_KEY not set — email verification disabled");
        return;
      }
      // `resend_verification` when the user explicitly clicks "resend"
      // (the middleware set the nonce + ip); `verification` on the initial
      // sign-up send (no middleware context).
      const emailType: EmailAuditType = emailRequestContext.getStore()
        ? "resend_verification"
        : "verification";
      await logEmailSend({
        email: user.email,
        userId: user.id,
        emailType,
        send: () =>
          resend.emails.send({
            from: FROM_ADDRESS,
            to: user.email,
            subject: "Verify your LoopStorm Guard account",
            html: `<p>Click the link below to verify your email address and activate your account.</p><p><a href="${url}">Verify Email</a></p><p>If you did not create a LoopStorm Guard account, you can ignore this email.</p>`,
          }),
      });
    },
  },

  socialProviders,

  session: {
    fields: {
      expiresAt: "expires_at",
      createdAt: "created_at",
      updatedAt: "updated_at",
      ipAddress: "ip_address",
      userAgent: "user_agent",
      userId: "user_id",
    },
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
 * Self-healing tenant resolution for authenticated users.
 *
 * Called by the tRPC auth middleware when the session's tenant_id is null.
 * This handles two failure modes:
 * 1. Session cache is stale — tenant was provisioned but the cached session
 *    does not include it yet. A direct DB read resolves this.
 * 2. Post-registration hook failed — tenant was never provisioned. A lazy
 *    provision attempt creates the tenant and back-fills the user/session rows.
 *
 * Returns the tenant_id on success, or null if all recovery attempts fail.
 */
export async function ensureTenantId(user: {
  id: string;
  name: string;
  email: string;
}): Promise<string | null> {
  // Check if tenant_id was set but session cache is stale.
  const [row] = await db
    .select({ tenant_id: users.tenant_id })
    .from(users)
    .where(eq(users.id, user.id));
  if (row?.tenant_id) return row.tenant_id;

  // Attempt lazy provision.
  try {
    await provisionTenantForUser(user);
  } catch (err) {
    console.error("[auth] ensureTenantId: lazy provision failed:", err);
    return null;
  }

  // Re-read after provision.
  const [repaired] = await db
    .select({ tenant_id: users.tenant_id })
    .from(users)
    .where(eq(users.id, user.id));
  return repaired?.tenant_id ?? null;
}

/**
 * The auth instance type, exported for use in middleware and tests.
 */
export type Auth = typeof auth;
