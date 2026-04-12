<!-- SPDX-License-Identifier: MIT -->
# ADR-021: Email Transport (Resend Primary, Mode 0 Stub, SMTP Fallback)

**Status:** Accepted
**Date:** 2026-04-10
**Author:** Lead Architect
**Deciders:** Lead Architect, Founder (GMW Solutions LLC)
**Supersedes:** None
**Related ADRs:** ADR-011 (Better Auth), ADR-014 (v1.1 mode definitions), ADR-015 (Vercel deployment / env var locus), ADR-022 (Rate Limiting — depends on this ADR for email send caps)
**Modes affected:** Mode 0 (stub), Mode 1 (optional SMTP), Mode 2 (Resend), Mode 3 (Resend)

---

## Context

### The problem

The v1.1 production readiness audit (`docs/v1.1-production-readiness-audit-2026-04-07.md`) identified **"Email verification broken — no SMTP"** as a P0 blocker. Better Auth (ADR-011) is configured with `requireEmailVerification: true` in `packages/backend/src/auth.ts` (line 156), but there is no `sendResetPassword`, `sendVerificationEmail`, or `sendMagicLink` handler wired. As a result:

1. **Sign-up is functionally broken.** A new user cannot verify their email and so cannot complete onboarding.
2. **Password reset is impossible.** Locked-out users have no recovery path.
3. **Magic-link flows cannot be enabled** even though Better Auth supports them.
4. **No operational email transport exists** anywhere in the backend. There is no `nodemailer`, no `resend`, no SES client, no SMTP config.

Until an email transport is wired, the SaaS product cannot onboard a second user.

### Constraints

- **Mode 0 must work air-gapped** (Absolute Rule #5). Email delivery requires network egress. The Mode 0 path must therefore be a **plane-clean no-op** that logs intent and returns success without any outbound HTTP or SMTP connection.
- **Better Auth integration is required.** The email transport must expose a stable `sendEmail({to, subject, html, text})` interface that Better Auth's email callbacks can call. Better Auth does not care which provider is behind the interface, so vendor choice is isolated from auth code.
- **Cost must be zero for development and MVP.** The founder is a solo operator running pre-revenue. Any email provider with a meaningful monthly minimum (Postmark: $15/month; SendGrid Essentials: $19.95/month) is rejected on cost grounds alone.
- **Deliverability must be production-grade.** SPF, DKIM, and DMARC must be possible and documented. Shared-IP reputation pools are acceptable for MVP; dedicated IPs are out of scope.
- **Secrets management via Vercel env vars.** Per ADR-015, the backend runs on Vercel. The email API key lives in `loopstorm-api` Vercel env vars alongside `BETTER_AUTH_SECRET` and `DATABASE_URL`.
- **Vendor independence at the call site.** The choice of provider must be swappable. No Better Auth code or tRPC handler should import the provider SDK directly.

### Alternatives considered

**Option A: AWS SES.** Cheap at scale ($0.10/1K emails), reliable, AWS-native.

- Pros: Lowest cost per email at volume. AWS's reputation is strong.
- Cons: Requires an AWS account and IAM setup for a solo-dev MVP whose infrastructure is entirely Vercel + Supabase. Account verification and sandbox-exit request adds days of setup. No free tier unless on EC2. DMARC/DKIM setup is manual and brittle. Overkill for v1.1.

**Option B: Postmark.** Premium deliverability, great templates, transactional-only focus.

- Pros: Best-in-class deliverability. Excellent documentation. Transactional and bulk are separated, which reduces cross-contamination risk.
- Cons: No free tier. Cheapest plan is $15/month for 10K emails. Rejected on cost.

**Option C: SendGrid.** Widely adopted, generous free tier historically.

- Pros: Historical brand recognition. Large template library.
- Cons: Shared-IP reputation issues have been widely reported. 2020+ deliverability reviews are mixed. Twilio ownership adds complexity. The free tier was sharply reduced in 2023. Rejected.

**Option D: Raw SMTP (self-hosted or generic relay).** Use `nodemailer` with SMTP credentials.

- Pros: Portable. No vendor lock-in. Works with any relay.
- Cons: Secrets management burden (host, port, user, pass, TLS mode). Brittle — connection pooling, retry, bounce handling all manual. Deliverability depends entirely on the relay operator. Not suitable as the primary Mode 3 transport.

**Option E: Resend.** API-first transactional email, React Email templates, generous free tier.

- Pros: 3,000 emails/month free forever (sufficient for MVP and small tenants). Simple REST API with a first-class TypeScript SDK (`resend` npm package). React Email template library (`@react-email/components`) is maintained by the same team, producing HTML that survives Gmail, Outlook, and Apple Mail. Domain verification wizard guides SPF/DKIM/DMARC setup. Founded by ex-Vercel employees; integrates naturally with Vercel deployments. Predictable pricing tier jumps ($20 for 50K/month). Strong deliverability reviews in 2025.
- Cons: Younger company than SES or Postmark (founded 2022). Vendor lock-in risk mitigated by wrapping behind `sendEmail` interface. Per-tenant reputation is shared until paid plans.

---

## Decision

**Adopt Resend as the primary email transport for Mode 2/3 (SaaS) deployments. Mode 0 (air-gapped) uses a no-op stub. Mode 1 (self-hosted) uses optional SMTP via `nodemailer` if `SMTP_HOST` is set, otherwise a logging stub.**

### Implementation Contract

#### 1. The `sendEmail` interface

A new module `packages/backend/src/lib/email.ts` exports a single asymmetric function:

```typescript
export interface SendEmailInput {
  to: string | string[];
  subject: string;
  html: string;
  text: string;
  replyTo?: string;
}

export interface SendEmailResult {
  id: string; // provider message id, or "noop-{uuid}" in Mode 0
  provider: "resend" | "smtp" | "noop";
}

export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult>;
```

Every caller (Better Auth callbacks, future invite flow, future billing receipts) uses this one function. No caller imports `resend` or `nodemailer` directly.

#### 2. Mode detection

The module reads `LOOPSTORM_MODE` from environment at module load time. Valid values: `"0"`, `"1"`, `"2"`, `"3"`. Default: `"0"` (fail-safe — a misconfigured deployment never accidentally sends real email).

Branching:

- **Mode 0 (`"0"`):** `sendEmail` logs the intent at `info` level (subject, to addresses — never the body), returns `{id: "noop-{uuid}", provider: "noop"}` without any network call.
- **Mode 1 (`"1"`):** If `SMTP_HOST` is set, lazily instantiate `nodemailer` transporter and send via SMTP. If `SMTP_HOST` is not set, log a warning once at startup ("Mode 1: no email transport configured, falling back to stub") and behave as Mode 0.
- **Mode 2 / Mode 3 (`"2"` or `"3"`):** Require `RESEND_API_KEY` at boot. Lazily instantiate the Resend client on first call. Send via Resend API.

#### 3. Env var contract

Added to `.env.local.example` (Wave 3 backend task):

```
# Email transport (ADR-021)
LOOPSTORM_MODE=0                    # 0=air-gap, 1=self-host, 2=hosted control plane, 3=SaaS
RESEND_API_KEY=                     # required in Mode 2/3
EMAIL_FROM=noreply@loop-storm.com   # must be on a domain verified in Resend
EMAIL_REPLY_TO=support@loop-storm.com
# Mode 1 optional SMTP fallback
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
SMTP_SECURE=false
```

Zod validation in `packages/backend/src/env.ts` enforces:

- If `LOOPSTORM_MODE` is `"2"` or `"3"`: `RESEND_API_KEY` and `EMAIL_FROM` must be set (fail-fast at boot).
- If `LOOPSTORM_MODE` is `"1"` and `SMTP_HOST` is set: `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` must be set.
- `EMAIL_FROM` must be a valid email address format.

#### 4. Better Auth wiring

`packages/backend/src/auth.ts` is amended to import `sendEmail` and provide three callbacks:

```typescript
import { sendEmail } from "./lib/email";
import { renderVerificationEmail, renderResetPasswordEmail, renderMagicLinkEmail } from "./lib/email-templates";

// inside betterAuth({...})
emailAndPassword: {
  enabled: true,
  requireEmailVerification: true,
  sendResetPassword: async ({ user, url }) => {
    const { html, text } = renderResetPasswordEmail({ userName: user.name ?? user.email, resetUrl: url });
    await sendEmail({ to: user.email, subject: "Reset your LoopStorm password", html, text });
  },
},
emailVerification: {
  sendVerificationEmail: async ({ user, url }) => {
    const { html, text } = renderVerificationEmail({ userName: user.name ?? user.email, verifyUrl: url });
    await sendEmail({ to: user.email, subject: "Verify your LoopStorm email", html, text });
  },
  sendOnSignUp: true,
  autoSignInAfterVerification: true,
},
```

If the magic-link plugin is enabled in a future ADR, its `sendMagicLink` callback uses the same `sendEmail` function.

#### 5. React Email templates

New directory `packages/backend/src/lib/email-templates/` contains four React Email component files:

1. `verify.tsx` — email verification
2. `reset-password.tsx` — password reset
3. `magic-link.tsx` — magic-link sign-in (stub; invoked only when the plugin is enabled)
4. `invite.tsx` — tenant invitation (stub; invoked only when invite flow ships)

Each file exports `render{Name}Email(props): {html: string; text: string}` using `@react-email/render`. Templates use the same layout wrapper (header, body, footer with unsubscribe link pointing to a stub route for now).

Per ADR-021 scope, only the bodies for `verify` and `reset-password` are wired in v1.1. `magic-link.tsx` and `invite.tsx` are rendered but the callers are TODO.

#### 6. DNS setup documentation

A new operator doc `docs/operators/email-setup.md` documents Resend domain verification step-by-step:

1. Add domain in Resend dashboard.
2. Add TXT record for SPF: `v=spf1 include:_spf.resend.com ~all`
3. Add TXT record for DKIM (Resend generates the selector).
4. Add TXT record for DMARC: `v=DMARC1; p=quarantine; rua=mailto:dmarc@loop-storm.com`
5. Wait for Resend to confirm verification.
6. Set `EMAIL_FROM` to an address on the verified domain.

For `loop-storm.com` (the production domain), these records are added to the DNS provider managing the root domain.

#### 7. Rate limiting interaction

Email sends are expensive and abuseable. ADR-022 specifies per-tenant and per-IP rate limits on email-triggering endpoints (sign-up, password reset, resend-verification). The email module itself does not enforce rate limits — it trusts the caller. Rate limiting is enforced upstream at the Better Auth and tRPC layer per ADR-022.

### Rationale

- **Resend over SES/Postmark/SendGrid:** free tier covers MVP, TypeScript SDK is first-class, React Email templates are maintainable, founded-by-ex-Vercel engineers means low-friction integration with the ADR-015 Vercel deployment, DNS wizard reduces deliverability failure modes.
- **Stub in Mode 0:** Absolute Rule #5. Air-gapped installs cannot and must not make outbound HTTP calls. The stub preserves interface parity so that the rest of the backend is mode-agnostic.
- **SMTP fallback in Mode 1:** enterprise self-hosted operators often have existing SMTP relays (corporate Exchange, Postfix, internal relay) and cannot adopt a SaaS email provider for policy reasons. `nodemailer` SMTP is the universal fallback. Full implementation is deferred — the Mode 1 code path is scaffolded in v1.1 but can log-and-stub until an operator needs it.
- **Single `sendEmail` entry point:** isolates vendor choice from caller code. Migrating to SES later is a one-file change.
- **React Email templates over raw HTML strings:** HTML emails that render correctly across Gmail, Outlook, and Apple Mail are notoriously fragile. React Email handles the escape hatches (inline CSS, table layouts, dark-mode variants) and is actively maintained.
- **Fail-fast env validation:** a Mode 3 deployment without `RESEND_API_KEY` must crash at boot, not silently degrade. This is consistent with the fail-closed default (Absolute Rule #2).

---

## Consequences

### Positive

1. **Unblocks Better Auth email flows.** Sign-up verification, password reset, and future magic-link and invite flows all work.
2. **Zero incremental cost for MVP.** Resend free tier covers 3,000 emails/month, sufficient for founder + ~30 early adopters.
3. **Mode 0 remains pure.** No network dependency introduced for air-gapped deployments.
4. **Vendor-swappable.** Replacing Resend with SES is a single-file change.
5. **Deliverability grounded in DNS.** SPF/DKIM/DMARC documented; operator follows a checklist, not tribal knowledge.
6. **Maintainable templates.** React Email templates are versioned, reviewed, and tested like any other TypeScript code.
7. **Composable with ADR-022 rate limiting.** Email-triggering endpoints can be rate-limited without changes to the email module.

### Negative

1. **Vendor lock-in to Resend.** Mitigated by the `sendEmail` interface. Migration away is a single-file change at the transport boundary.
2. **Requires DNS configuration per domain.** Operators must add SPF/DKIM/DMARC records. Documented but adds a setup step.
3. **Free tier caps at 3,000 emails/month and 100 emails/day per single send.** A sudden traffic surge or a spam-bot-triggered reset flood could exhaust the free tier within hours. Mitigated by ADR-022 rate limits and by Resend's paid tier ($20 for 50K/month) as the upgrade path.
4. **No per-tenant template customization in v1.1.** All tenants receive the same-branded verification and reset emails. Deferred to post-v1.1.
5. **No bounce/complaint webhook handling in v1.1.** Resend's webhooks for bounces, complaints, and delivery events are not consumed. Hard bounces will silently fail rather than suppressing the recipient. Deferred to v1.2 — documented as future work.
6. **Template rendering adds ~5-20ms per email send.** React Email rendering is synchronous and not free. Acceptable on a non-hot path.

### Neutral

1. **`nodemailer` is a dev dependency of the Mode 1 path only.** It is not loaded unless `SMTP_HOST` is set. No bundle-size impact on Mode 2/3.
2. **`resend` SDK is a dev dependency loaded only in Mode 2/3.** Conditional import keeps Mode 0 bundle free of provider SDKs.
3. **`EMAIL_FROM` domain must match the Resend-verified domain.** Typo protection via zod regex is possible but deferred; operator runbook catches this.

---

## Migration Path

### From "broken, no email" to "working Resend"

1. **Add the `resend` npm dependency** to `packages/backend/package.json` dependencies.
2. **Add `nodemailer` and `@types/nodemailer`** as optional (Mode 1 only) dependencies.
3. **Add `@react-email/components` and `@react-email/render`** to dependencies.
4. **Create `packages/backend/src/lib/email.ts`** implementing the `sendEmail` function with mode branching.
5. **Create `packages/backend/src/lib/email-templates/`** directory with `verify.tsx`, `reset-password.tsx`, `magic-link.tsx`, `invite.tsx`.
6. **Amend `packages/backend/src/env.ts`** to validate `LOOPSTORM_MODE`, `RESEND_API_KEY`, `EMAIL_FROM`, `EMAIL_REPLY_TO`, and optional SMTP_* vars per zod refinements.
7. **Amend `packages/backend/src/auth.ts`** to wire `emailVerification.sendVerificationEmail` and `emailAndPassword.sendResetPassword` to `sendEmail`.
8. **Add `RESEND_API_KEY`, `EMAIL_FROM`, `EMAIL_REPLY_TO`, `LOOPSTORM_MODE=3`** to `loopstorm-api` Vercel env vars.
9. **Create `docs/operators/email-setup.md`** with Resend domain verification steps.
10. **Amend `docs/secrets-inventory.md`** to add `RESEND_API_KEY` and note rotation schedule (quarterly).
11. **Amend `.env.local.example`** to document all new vars.
12. **Add unit tests** for Mode 0 stub behavior and env validation.
13. **Manually verify** the first real sign-up in staging receives a verification email.

### Future migrations

- **If Resend pricing or reliability degrades:** swap `resend` for `@aws-sdk/client-sesv2` behind the same `sendEmail` interface. Estimated effort: half a day for the transport swap, plus DNS migration for SES domain verification.
- **If operators request per-tenant template customization:** add a `tenant.email_templates` table, load templates per tenant in `sendEmail`, render with tenant overrides. Deferred.
- **If bounce rate exceeds 5%:** enable Resend webhooks, add a `email_suppressions` table, check it before every send. Deferred to v1.2.

---

## Security Considerations

1. **`RESEND_API_KEY` is a production-grade secret.** Stored in Vercel env vars (encrypted at rest), never committed, rotated quarterly per `docs/secrets-inventory.md` cadence. A leaked key allows an attacker to send email from the verified domain, damaging reputation and potentially triggering provider suspension.
2. **`EMAIL_FROM` domain must be SPF/DKIM/DMARC-aligned.** Without DMARC, an attacker can spoof `noreply@loop-storm.com` from other servers. DMARC policy `p=quarantine` or stricter is required in production. `docs/operators/email-setup.md` documents this.
3. **Rate limiting on send-triggering endpoints is mandatory.** Without rate limits, an attacker can drain the free tier by hitting `/api/auth/forget-password` repeatedly with valid email addresses. Enforced by ADR-022 Layer 1 (Better Auth built-in rate limiter on reset endpoints) and ADR-022 Layer 2 (tRPC middleware on custom email-triggering procedures).
4. **Never log email bodies.** The stub and the Resend path both log only `to`, `subject`, and `provider message id`. Bodies may contain reset tokens, magic-link URLs, or personal data.
5. **Reset tokens and magic-links are short-lived.** Better Auth defaults are used; no ADR change required. Verify defaults during implementation: typical 15-60 minute expiry.
6. **Bounce/complaint webhooks (future).** When added in v1.2, the webhook endpoint must verify Resend's signature header to prevent spoofed bounce reports from poisoning the suppression list.
7. **Mode 0 must never leak to production.** Zod validation in `env.ts` that fails fast when `LOOPSTORM_MODE=0` is set on a production deployment (detected via `VERCEL_ENV=production`). This is a defense against an operator accidentally deploying with the default.

---

## Acceptance Criteria

- **AC-21-1:** `packages/backend/src/lib/email.ts` exports `sendEmail(input: SendEmailInput): Promise<SendEmailResult>` with the exact signature defined in this ADR.
- **AC-21-2:** Mode 0 `sendEmail` returns `{id: "noop-{uuid}", provider: "noop"}` without any network call. Verified by a unit test that fails if `fetch` or `nodemailer.createTransport` is called.
- **AC-21-3:** Mode 3 with missing `RESEND_API_KEY` fails at boot via zod refinement in `packages/backend/src/env.ts`. Verified by a unit test.
- **AC-21-4:** Mode 1 with `SMTP_HOST` unset logs a warning once and behaves as Mode 0. Verified by a unit test.
- **AC-21-5:** `packages/backend/src/auth.ts` wires `emailVerification.sendVerificationEmail` and `emailAndPassword.sendResetPassword` to the `sendEmail` function. No direct `resend` or `nodemailer` import.
- **AC-21-6:** Four React Email templates exist: `verify.tsx`, `reset-password.tsx`, `magic-link.tsx`, `invite.tsx`. Each exports a `render{Name}Email(props): {html, text}` function.
- **AC-21-7:** `docs/secrets-inventory.md` lists `RESEND_API_KEY` with rotation cadence (quarterly).
- **AC-21-8:** `.env.local.example` documents `LOOPSTORM_MODE`, `RESEND_API_KEY`, `EMAIL_FROM`, `EMAIL_REPLY_TO`, and Mode 1 SMTP vars with inline comments.
- **AC-21-9:** `docs/operators/email-setup.md` exists and walks the operator through Resend domain verification with SPF, DKIM, and DMARC record examples.
- **AC-21-10:** Unit test: Mode 0 stub returns success without calling any network API.
- **AC-21-11:** Unit test: Mode 3 missing `RESEND_API_KEY` fails `env.ts` validation at boot.
- **AC-21-12:** Unit test: template rendering for `verify` and `reset-password` produces non-empty `html` and `text` strings.
- **AC-21-13:** Integration test (stubbed): Better Auth's `emailVerification.sendVerificationEmail` is invoked and the stub records the call with the expected `to`, `subject`, and a URL in the HTML body.
- **AC-21-14:** Zod refinement in `env.ts` rejects `LOOPSTORM_MODE=0` when `VERCEL_ENV=production`.
- **AC-21-15:** A manual smoke test in staging: create a new user via `/api/auth/sign-up`, confirm a verification email arrives at the test inbox within 30 seconds, click the link, confirm account is marked verified.
- **AC-21-16:** `RESEND_API_KEY`, `EMAIL_FROM`, `EMAIL_REPLY_TO`, `LOOPSTORM_MODE=3` are present in the `loopstorm-api` Vercel env var inventory (verified via `bunx vercel env ls` or dashboard screenshot attached to the PR).

---

## Out of Scope (Deferred)

1. **Full SMTP fallback implementation.** The Mode 1 SMTP code path is scaffolded (mode branch exists, env vars documented) but only the logging stub is wired. An operator requesting Mode 1 SMTP in production must follow a future v1.2 PR.
2. **Bounce and complaint webhook handling.** Resend's webhooks (`email.bounced`, `email.complained`, `email.delivered`) are not consumed. Hard bounces silently fail. Deferred to v1.2.
3. **Per-tenant template customization.** All tenants get the same email branding. Deferred to post-v1.1.
4. **Transactional email types beyond auth.** Billing receipts, digest emails, and notification emails are not in v1.1. The module is ready; callers are not.
5. **Email tracking pixels and click tracking.** Not implemented. Not required in v1.1.
6. **Internationalization of email templates.** English only in v1.1.
7. **Email preview route** (`/api/internal/email-preview?template=verify`) for design review. Useful but not blocking.

---

## References

- ADR-011 — Better Auth (auth layer that consumes `sendEmail`)
- ADR-014 — v1.1 Gate Resolutions (mode definitions)
- ADR-015 — Backend Deployment Target (Vercel env var locus for `RESEND_API_KEY`)
- ADR-022 — Rate Limiting (enforces caps on email-triggering endpoints)
- `docs/v1.1-production-readiness-audit-2026-04-07.md` — P0 blocker "Email verification broken"
- `packages/backend/src/auth.ts` — current Better Auth config with `requireEmailVerification: true` at line 156
- `HANDOFF.md` §6 — missing env vars list
- Better Auth email docs: https://www.better-auth.com/docs/authentication/email-password
- Resend docs: https://resend.com/docs/introduction
- React Email docs: https://react.email/docs/introduction
- Resend Node SDK: https://github.com/resendlabs/resend-node
