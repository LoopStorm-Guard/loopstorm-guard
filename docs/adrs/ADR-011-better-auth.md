<!-- SPDX-License-Identifier: MIT -->
# ADR-011: Better Auth for Authentication

**Status:** Adopted
**Date:** 2026-03-13
**Decision authority:** Ricardo (Founder / Principal Architect)

---

## Context

The hosted control plane requires authentication for two distinct flows:

1. **Human authentication** — users accessing the web UI and mobile app (email, OAuth).
2. **SDK authentication** — engine/shim instances authenticating to the backend API for event ingest.

The product document (v1.2) references Supabase Auth for human session management. However, Supabase Auth has limitations:

- Tight coupling to the Supabase platform, making Mode 1 (self-hosted) more complex.
- Limited customization of auth flows and token claims without Edge Functions.
- API key management for SDK auth is not a first-class Supabase Auth feature.

---

## Decision

**Better Auth** is the authentication framework for the LoopStorm hosted control plane.

Better Auth provides:
- Email + password authentication with built-in rate limiting.
- OAuth providers (Google, GitHub) with standard OIDC flows.
- Session management with secure cookies and JWT issuance.
- Custom claims in JWTs (tenant_id for RLS policies).
- API key management as a first-class feature (for SDK authentication).
- Framework-agnostic — works with Hono, Next.js, and Expo.
- Self-hostable — no dependency on a specific platform's auth service.

The integration architecture:
- Better Auth runs as middleware in the Hono API server.
- JWTs issued by Better Auth include a `tenant_id` claim consumed by Supabase RLS policies.
- The web UI and mobile app use Better Auth's session management.
- SDK authentication uses Better Auth-managed API keys (SHA-256 hashed, raw key never stored).
- Supabase PostgreSQL remains the user/session data store, but auth logic is in Better Auth, not Supabase Auth.

**Supabase Auth must not be used.** References to Supabase Auth in earlier product documents are superseded by this ADR. All auth flows go through Better Auth.

---

## Consequences

**Positive:**
- Decoupled from Supabase platform. Mode 1 (self-hosted) can use any PostgreSQL database.
- API key management is first-class, not bolted on.
- Full control over token claims, session lifecycle, and auth flows.
- Single auth framework across web, mobile, and SDK surfaces.

**Negative:**
- Supabase Realtime subscriptions require a JWT that Supabase trusts. Better Auth JWTs must be configured as a custom JWT source for Supabase, or a JWT exchange mechanism must be implemented. This is a known integration point that requires careful implementation.
- Better Auth is a newer framework with a smaller community than Supabase Auth. Risk is mitigated by its MIT license and straightforward codebase.

---

## Migration Path

If Better Auth proves insufficient (e.g., missing enterprise SSO features needed for v2), migration to an alternative auth framework (e.g., Lucia, custom implementation) is feasible because the auth layer is a middleware concern, not a database schema concern. The JWT claim structure (`tenant_id`) and API key table schema should be treated as stable interfaces that any auth implementation must produce.
