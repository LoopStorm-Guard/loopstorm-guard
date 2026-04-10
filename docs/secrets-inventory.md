<!-- SPDX-License-Identifier: MIT -->
# LoopStorm Guard — Secrets Inventory

**Maintained by:** Platform Engineering
**Last reviewed:** 2026-03-13

All secrets are stored in GitHub Actions repository secrets or environment secrets.
No secret ever appears in git history. Secret scanning is enabled on the repository.

Verify: `git log --all --full-history -- '*.env'` must return empty.

---

## CI/CD Secrets (GitHub Actions)

| Secret Name | Scope | Used In | Rotation | Notes |
|---|---|---|---|---|
| `RELEASE_GPG_KEY` | CI | `engine-build.yml` (tagged releases) | Annually | Base64-encoded GPG private key for signing release binaries |
| `RELEASE_GPG_PASSPHRASE` | CI | `engine-build.yml` (tagged releases) | Annually | Passphrase for `RELEASE_GPG_KEY` |
| `VERCEL_TOKEN` | CI/CD | deploy workflow (ADR-015) | Annually | Vercel personal access token for deployment |
| `VERCEL_ORG_ID` | CI/CD | deploy workflow (ADR-015) | When org changes | Vercel organization ID |
| `VERCEL_PROJECT_ID_API` | CI/CD | deploy workflow (ADR-015) | When project changes | Vercel project ID for backend (Vercel Functions per ADR-015) |
| `VERCEL_PROJECT_ID_WEB` | CI/CD | deploy workflow (ADR-015) | When project changes | Vercel project ID for web UI |
| `PYPI_API_TOKEN` | CI | `shim-python-release.yml` | Annually | PyPI upload token for `loopstorm` package |
| `NPM_TOKEN` | CI | `shim-ts-release.yml` | Annually | npm publish token for `@loopstorm/shim-ts` |

---

## Backend Runtime Secrets (Vercel Environment Variables)

| Secret Name | Scope | Rotation | Notes |
|---|---|---|---|
| `DATABASE_URL` | Backend runtime | On compromise | Full Postgres connection string incl. password |
| `SUPABASE_URL` | Backend runtime | When project changes | Supabase project URL (Storage + Realtime only — no Auth) |
| `SUPABASE_SERVICE_ROLE_KEY` | Backend runtime | Quarterly | Full access key — never expose to client |
| `BETTER_AUTH_SECRET` | Backend runtime | On compromise | 32+ byte random secret. Rotation invalidates ALL sessions — requires maintenance window |
| `GOOGLE_CLIENT_ID` | Backend runtime | On compromise | OAuth 2.0 client ID for Google sign-in |
| `GOOGLE_CLIENT_SECRET` | Backend runtime | On compromise | OAuth 2.0 client secret |
| `ANTHROPIC_API_KEY` | Backend runtime | Quarterly | Powers the AI Supervisor (ADR-017). Holds the DeepSeek API key in Mode 3 SaaS. Scope: supervisor worker only |
| `SUPERVISOR_BUDGET_HARD_USD` | Backend runtime | On policy change | Value: `2.00`. Not a secret, but tracked here |
| `PRODUCTION_DATABASE_URL` | CI deploy-time | On compromise | Used by `drizzle-kit migrate` during deployment. May differ from runtime URL |

---

## Frontend Runtime Variables (Vercel)

These are public (NEXT_PUBLIC_*) and not secrets, but tracked here for inventory completeness.

| Variable | Notes |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL — Realtime only |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key — Realtime only. Safe to expose to browser |
| `NEXT_PUBLIC_API_URL` | URL of the deployed backend API |

---

## Per-Customer Secrets

| Secret Type | Owner | Notes |
|---|---|---|
| `LOOPSTORM_API_KEY` | Customer-controlled | Issued per tenant. Format: `lsg_<random>`. SHA-256 hash stored in DB, never plaintext. Rotation: customer-initiated |

---

## Rotation Procedures

### `BETTER_AUTH_SECRET` (session-invalidating)
1. Schedule a maintenance window.
2. Generate a new 32-byte random secret: `openssl rand -base64 32`
3. Update the Vercel environment variable.
4. Redeploy the backend.
5. All existing sessions are invalidated — users must log in again.
6. Notify users via status page before the window.

### `DATABASE_URL` / `PRODUCTION_DATABASE_URL`
1. Generate new database credentials.
2. Update both the Vercel environment variable and the GitHub secret.
3. Redeploy — migration runs with the new credentials.
4. Revoke old credentials in Supabase dashboard.

### GPG Signing Key
1. Generate new key: `gpg --gen-key`
2. Export: `gpg --armor --export-secret-key <key-id> | base64`
3. Update `RELEASE_GPG_KEY` and `RELEASE_GPG_PASSPHRASE` in GitHub.
4. Publish new public key to keyserver.
5. Update release verification docs.
