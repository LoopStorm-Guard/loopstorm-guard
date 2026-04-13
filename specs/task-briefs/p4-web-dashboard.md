<!-- SPDX-License-Identifier: MIT -->
# Task Brief: P4 -- Web Dashboard

**Priority:** P4
**Assignee:** `frontend-senior-engineer` agent
**Branch:** `feat/p4-web-dashboard` (from `main` at latest)
**Gate:** P4 Web Dashboard Architecture -- RESOLVED by this document
**Blocked by:** P3 Backend + Database (merged)
**Blocks:** OSS release checklist (hosted-tier UI), P5 remaining specs
**Date:** 2026-03-19

---

## 1. Objective

Deliver the LoopStorm Guard web dashboard in `packages/web/` using Next.js 15
App Router. The dashboard consumes the tRPC API from `packages/backend/` for
all data access and uses Better Auth for authentication.

After this PR:

1. Users can sign in (email+password, Google OAuth) and sign up via Better Auth.
2. Users can view a paginated list of agent runs with status badges.
3. Users can view a run's event timeline with decision badges and chain verification.
4. Users can manage policy packs (list, create, edit) with optimistic concurrency.
5. Users can manage API keys (list, create, revoke) with one-time key display.
6. Users can view and act on supervisor proposals and escalations.
7. The UI uses a consistent design system with semantic colors for decisions.

---

## 2. Constraints

| # | Constraint | Source |
|---|---|---|
| C1 | **AGPL-3.0-only** -- every `.ts`/`.tsx`/`.css` file in `packages/web/` gets `// SPDX-License-Identifier: AGPL-3.0-only` | ADR-013 |
| C2 | **Better Auth ONLY** -- never Supabase Auth / GoTrue. Auth flows through the Better Auth client SDK | ADR-011 |
| C3 | **Next.js 15 App Router** -- server components by default, `"use client"` only where browser APIs or interactivity are required | Tech stack |
| C4 | **Bun runtime** -- `bun install`, `bun test`, `bun run dev`. Never npm/yarn/pnpm | CLAUDE.md |
| C5 | **Biome** for linting/formatting -- 2-space indentation, double quotes, trailing commas (es5), semicolons. `noExplicitAny: "error"` in web override | biome.json |
| C6 | **Do NOT modify backend code** -- consume the existing tRPC API exactly as-is. If a procedure is missing or wrong, flag it in this brief (do not fix it) | Task scope |
| C7 | **Import `AppRouter` type only** -- never import the actual `appRouter` value from `@loopstorm/api`. Only the type is safe to cross the package boundary | `packages/backend/src/trpc/router.ts` comment |
| C8 | **`@loopstorm/schemas`** (MIT) for shared types -- import `Decision`, `EventType`, `LoopStormEvent`, `PolicyPack`, etc. from this package | ADR-013, ADR-003 |
| C9 | **Enforcement/observation plane separation** -- the dashboard displays observation-plane data. It never calls enforcement-plane endpoints (there are none in the backend) | ADR-012 |
| C10 | **`escalate_to_human` can never be blocked** -- the supervisor escalation UI must always render and allow acknowledgement | ADR-012 |
| C11 | **Mode 0 irrelevant** -- the web dashboard is a hosted-tier component (Mode 2/3). Air-gapped deployments use the CLI only | Product doc |
| C12 | **Turbo** -- ensure `build`/`test`/`lint`/`typecheck` tasks work with existing `turbo.json` | turbo.json |

---

## 3. Pre-Work: Package.json Cleanup

The existing `packages/web/package.json` has a **stale dependency** that must
be removed before any new work:

```
"@supabase/supabase-js": "^2.47.10"  // REMOVE -- we use Better Auth, not Supabase client
```

This was a leftover from the initial scaffold. The web package must NEVER
import `@supabase/supabase-js` directly. All data access goes through tRPC.
All auth goes through Better Auth's client SDK.

---

## 4. Architectural Decisions

### AD-P4-1: Tailwind CSS v4 for Styling

**Decision**: Use Tailwind CSS v4 with the Next.js PostCSS integration. No
component library (no shadcn/ui, no Radix primitives, no Headless UI in v1).

**Rationale**: Tailwind v4 provides utility-first styling with zero-runtime
overhead. The dashboard is a developer tool, not a consumer app -- it needs
clarity and density, not animation libraries. Avoiding a component library
keeps the dependency tree minimal and the bundle small. If a component
library is needed later, shadcn/ui (which uses Tailwind) can be added
incrementally without rework.

**CSS custom properties**: Define design tokens as CSS custom properties in
`globals.css`. Tailwind classes reference these tokens. This gives a single
source of truth for the color system.

### AD-P4-2: tRPC Vanilla Client (Not React Query Integration)

**Decision**: Use `@trpc/client` with vanilla `createTRPCClient` and
direct `await` calls in server components. For client components that need
reactive data, use the `@trpc/tanstack-react-query` integration with
TanStack Query v5.

**Rationale**: Next.js 15 server components can `await` data directly --
wrapping every call in React Query adds unnecessary complexity for pages
that render once. Client components (e.g., the approval buttons, pagination
controls, real-time polling) genuinely benefit from React Query's cache
invalidation, optimistic updates, and error retry.

**Setup pattern**:
- `src/lib/trpc-server.ts` -- vanilla tRPC client for server components.
  Uses `httpBatchLink` pointed at the backend API URL. Passes cookies from
  the incoming request for session auth (via `headers()` from `next/headers`).
- `src/lib/trpc-client.ts` -- React Query tRPC client for client components.
  Configured with `httpBatchLink` and `credentials: "include"` for cookies.
- `src/lib/trpc-provider.tsx` -- `"use client"` provider wrapping
  `QueryClientProvider` + `trpc.Provider`. Mounted in `layout.tsx`.

### AD-P4-3: Better Auth Client SDK

**Decision**: Use the `better-auth/react` client for auth state, sign-in,
sign-up, and sign-out. The auth client communicates with the backend's
`/api/auth/**` endpoints (proxied through Next.js rewrites or direct calls).

**Rationale**: Better Auth provides a React client that handles session
cookies, CSRF protection, and OAuth redirect flows. It is the official
integration path for Better Auth with React frameworks.

**Setup**:
- `src/lib/auth-client.ts` -- creates the Better Auth client instance
  pointed at the backend URL. Exports `signIn`, `signOut`, `useSession`.
- Auth pages use the client methods directly. No Supabase Auth anywhere.
- Session state (logged in / tenant_id) is available via `useSession()`.

### AD-P4-4: Server Components by Default, Client Components Sparingly

**Decision**: All pages and layout components are server components unless
they require interactivity. The following are client components:

| Component | Why client? |
|---|---|
| `auth-form.tsx` | Form inputs, Better Auth client methods |
| `trpc-provider.tsx` | React context for tRPC + React Query |
| `sidebar-nav.tsx` | Active link highlighting with `usePathname()` |
| `runs-table.tsx` | Pagination, cursor-based "load more" |
| `event-timeline.tsx` | Expandable event details, scroll |
| `chain-badge.tsx` | Calls `verify.chain` on mount, updates UI |
| `policy-editor.tsx` | JSON editor, form submission |
| `conflict-dialog.tsx` | Optimistic concurrency conflict resolution |
| `api-key-create-dialog.tsx` | Form + one-time key display |
| `proposal-actions.tsx` | Approve/reject buttons with mutation |
| `escalation-actions.tsx` | Acknowledge button with mutation |

Server components handle data fetching. Client components handle interaction.

### AD-P4-5: Next.js Rewrites for Backend Proxy (Development)

**Decision**: In development, Next.js rewrites `/api/auth/**` and
`/api/trpc/**` to the backend server (`http://localhost:3001`). This avoids
CORS issues during development because the frontend and backend appear to
share the same origin.

**Rationale**: In production, the backend runs on a separate domain
(e.g., `api.loop-storm.com`) and CORS is configured properly. In development,
the rewrite proxy is simpler than configuring CORS for `localhost:3000` ->
`localhost:3001`.

**Config**: `next.config.ts` with `rewrites()` returning source/destination
pairs. The tRPC client URL uses `/api/trpc` (relative, through the proxy)
in development and the absolute backend URL in production.

### AD-P4-6: No Supabase Realtime in v1

**Decision**: The dashboard uses polling (via React Query `refetchInterval`)
for live updates, not Supabase Realtime subscriptions.

**Rationale**: Supabase Realtime requires a JWT that Supabase trusts. Since
we use Better Auth (not Supabase Auth), integrating Realtime requires a JWT
exchange mechanism (noted in ADR-011 consequences). This is non-trivial and
out of scope for v1. Polling every 5-10 seconds is adequate for a developer
dashboard. Realtime can be added in v2 after the JWT bridge is built.

### AD-P4-7: Route Group Structure

**Decision**: Use Next.js route groups to separate authenticated and
unauthenticated layouts:

```
src/app/
  (auth)/               -- unauthenticated layout (no sidebar)
    sign-in/page.tsx
    sign-up/page.tsx
  (dashboard)/          -- authenticated layout (sidebar + header)
    layout.tsx          -- sidebar, header, auth guard
    page.tsx            -- dashboard home (redirect to /runs)
    runs/
      page.tsx          -- runs list
      [runId]/page.tsx  -- run detail + event timeline
    policies/
      page.tsx          -- policy list
      new/page.tsx      -- create policy
      [id]/edit/page.tsx -- edit policy
    api-keys/
      page.tsx          -- API key management
    supervisor/
      page.tsx          -- proposals + escalations
    settings/
      page.tsx          -- future: tenant settings
  layout.tsx            -- root layout (html, body, providers)
  page.tsx              -- landing redirect (-> /sign-in or /runs)
```

**Rationale**: Route groups provide distinct layouts without adding path
segments. The auth pages get a clean centered layout. The dashboard pages
get the sidebar layout. The root `page.tsx` checks auth state and redirects
accordingly.

### AD-P4-8: No Global State Library

**Decision**: Use React Query for server state (tRPC data) and React
`useState`/`useReducer` for local component state. No Redux, Zustand, or
Jotai.

**Rationale**: The dashboard has no complex cross-cutting client state. Every
page fetches its own data via tRPC. React Query's cache handles cross-page
data sharing (e.g., navigating from runs list to run detail). Adding a state
library is premature complexity.

---

## 5. Design System Tokens

All design tokens are CSS custom properties defined in `src/app/globals.css`.
Colors use OKLCH for perceptual uniformity.

### 5.1 Decision Colors

These are the primary semantic colors for the product. Every decision type
has a distinct color that is used consistently everywhere in the UI.

| Decision | CSS Variable | Usage | Suggested OKLCH |
|---|---|---|---|
| `allow` | `--color-decision-allow` | Badges, timeline dots, table cells | `oklch(0.72 0.17 142)` (green) |
| `deny` | `--color-decision-deny` | Badges, timeline dots, table cells | `oklch(0.63 0.21 25)` (red) |
| `cooldown` | `--color-decision-cooldown` | Badges, timeline dots, table cells | `oklch(0.75 0.16 70)` (amber) |
| `kill` | `--color-decision-kill` | Badges, timeline dots, table cells | `oklch(0.30 0.00 0)` (near-black) |
| `require_approval` | `--color-decision-approval` | Badges, timeline dots, table cells | `oklch(0.65 0.15 280)` (purple) |

### 5.2 Status Colors

| Status | CSS Variable | Usage |
|---|---|---|
| `started` | `--color-status-started` | Run status badge (blue) |
| `completed` | `--color-status-completed` | Run status badge (green) |
| `terminated_*` | `--color-status-terminated` | Run status badge (red) |
| `abandoned` | `--color-status-abandoned` | Run status badge (gray) |
| `error` | `--color-status-error` | Run status badge (red) |

### 5.3 Severity Colors (Escalations)

| Severity | CSS Variable | Usage |
|---|---|---|
| `low` | `--color-severity-low` | Escalation badge (gray) |
| `medium` | `--color-severity-medium` | Escalation badge (amber) |
| `high` | `--color-severity-high` | Escalation badge (orange) |
| `critical` | `--color-severity-critical` | Escalation badge (red, pulsing) |

### 5.4 Chain Verification Badge

| State | Visual | CSS Variable |
|---|---|---|
| Verified | Green shield with checkmark | `--color-chain-verified` |
| Broken | Red shield with X | `--color-chain-broken` |
| Pending | Gray shield with spinner | `--color-chain-pending` |
| Not found | Gray shield with dash | `--color-chain-notfound` |

### 5.5 Layout Tokens

| Token | Value | Usage |
|---|---|---|
| `--sidebar-width` | `16rem` | Fixed sidebar width |
| `--header-height` | `3.5rem` | Fixed header height |
| `--page-max-width` | `80rem` | Content area max width |
| `--font-mono` | `"JetBrains Mono", "Fira Code", monospace` | Code, hashes, JSON |
| `--font-sans` | `"Inter", system-ui, sans-serif` | Body text |

### 5.6 Typography Scale

Use Tailwind's default type scale. Override only the font families:
- Body: `--font-sans`
- Code/hashes: `--font-mono`
- Labels: `text-xs font-medium uppercase tracking-wide`

---

## 6. Component Hierarchy

```
RootLayout
  TRPCProvider ("use client")
    QueryClientProvider
      (auth)/layout.tsx          -- centered card layout
        SignInPage
          AuthForm
        SignUpPage
          AuthForm
      (dashboard)/layout.tsx     -- sidebar + header + content
        DashboardHeader          -- tenant name, user menu
        SidebarNav ("use client") -- nav links, active state
        <page content>
```

### 6.1 Shared Components (`src/components/`)

| Component | File | Server/Client | Description |
|---|---|---|---|
| `DecisionBadge` | `decision-badge.tsx` | Server | Colored pill for decision type |
| `StatusBadge` | `status-badge.tsx` | Server | Colored pill for run status |
| `SeverityBadge` | `severity-badge.tsx` | Server | Colored pill for escalation severity |
| `ChainBadge` | `chain-badge.tsx` | Client | Shield icon + verified/broken state |
| `TimeAgo` | `time-ago.tsx` | Client | Relative timestamp (e.g. "2m ago") |
| `LoadMoreButton` | `load-more.tsx` | Client | Cursor-based pagination trigger |
| `EmptyState` | `empty-state.tsx` | Server | Placeholder for empty lists |
| `CopyButton` | `copy-button.tsx` | Client | Click-to-copy (API keys, hashes) |
| `ConfirmDialog` | `confirm-dialog.tsx` | Client | Generic confirmation modal |
| `JsonViewer` | `json-viewer.tsx` | Client | Collapsible JSON tree for event data |
| `BudgetBar` | `budget-bar.tsx` | Server | Horizontal progress bar for budget usage |
| `PageHeader` | `page-header.tsx` | Server | Page title + optional actions |

### 6.2 Page-Specific Components

| Page | Component | File | Description |
|---|---|---|---|
| Runs | `RunsTable` | `runs/runs-table.tsx` | Paginated table with status, agent, cost, dates |
| Runs | `RunsFilter` | `runs/runs-filter.tsx` | Status filter dropdown |
| Run Detail | `RunHeader` | `runs/[runId]/run-header.tsx` | Run metadata + chain badge + budget summary |
| Run Detail | `EventTimeline` | `runs/[runId]/event-timeline.tsx` | Chronological event list with decision badges |
| Run Detail | `EventDetail` | `runs/[runId]/event-detail.tsx` | Expandable single event (args, rule, reason) |
| Policies | `PolicyList` | `policies/policy-list.tsx` | Paginated policy cards |
| Policies | `PolicyEditor` | `policies/policy-editor.tsx` | JSON textarea + validation feedback |
| Policies | `ConflictDialog` | `policies/conflict-dialog.tsx` | Version conflict resolution |
| API Keys | `ApiKeyTable` | `api-keys/api-key-table.tsx` | Key list with masked prefix |
| API Keys | `CreateKeyDialog` | `api-keys/create-key-dialog.tsx` | Key creation + one-time display |
| Supervisor | `ProposalQueue` | `supervisor/proposal-queue.tsx` | Pending proposals with actions |
| Supervisor | `ProposalCard` | `supervisor/proposal-card.tsx` | Single proposal detail |
| Supervisor | `EscalationQueue` | `supervisor/escalation-queue.tsx` | Open escalations with actions |
| Supervisor | `EscalationCard` | `supervisor/escalation-card.tsx` | Single escalation detail |

---

## 7. File Inventory

Every file the implementing agent must create or modify. Files marked
`[MODIFY]` already exist; all others are `[CREATE]`.

### 7.1 Configuration

| File | Action | Description |
|---|---|---|
| `packages/web/package.json` | MODIFY | Remove `@supabase/supabase-js`, add tRPC client, Better Auth client, TanStack Query, Tailwind deps |
| `packages/web/next.config.ts` | CREATE | API proxy rewrites, env vars |
| `packages/web/postcss.config.mjs` | CREATE | PostCSS config for Tailwind v4 |
| `packages/web/tsconfig.json` | MODIFY | Add path aliases if needed |
| `packages/web/.env.example` | CREATE | `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_BETTER_AUTH_URL` |

### 7.2 Root Layout and Providers

| File | Description |
|---|---|
| `src/app/globals.css` | Tailwind imports + CSS custom property tokens |
| `src/app/layout.tsx` | MODIFY -- add font imports, globals.css, TRPCProvider |
| `src/app/page.tsx` | MODIFY -- auth-aware redirect |
| `src/lib/trpc-server.ts` | Vanilla tRPC client for server components |
| `src/lib/trpc-client.ts` | React Query tRPC client for client components |
| `src/lib/trpc-provider.tsx` | "use client" -- QueryClientProvider + trpc.Provider |
| `src/lib/auth-client.ts` | Better Auth React client instance |
| `src/lib/env.ts` | Type-safe env vars (NEXT_PUBLIC_API_URL, etc.) |

### 7.3 Auth Pages

| File | Description |
|---|---|
| `src/app/(auth)/layout.tsx` | Centered card layout, no sidebar |
| `src/app/(auth)/sign-in/page.tsx` | Sign-in page |
| `src/app/(auth)/sign-up/page.tsx` | Sign-up page |
| `src/components/auth/auth-form.tsx` | "use client" -- email/password form + Google OAuth button |

### 7.4 Dashboard Layout

| File | Description |
|---|---|
| `src/app/(dashboard)/layout.tsx` | Sidebar + header + auth guard |
| `src/app/(dashboard)/page.tsx` | Redirect to /runs |
| `src/components/layout/sidebar-nav.tsx` | "use client" -- nav links |
| `src/components/layout/dashboard-header.tsx` | Tenant context, user menu, sign out |
| `src/components/layout/user-menu.tsx` | "use client" -- dropdown with sign-out |

### 7.5 Runs Pages

| File | Description |
|---|---|
| `src/app/(dashboard)/runs/page.tsx` | Server component -- fetches initial page |
| `src/app/(dashboard)/runs/runs-table.tsx` | "use client" -- paginated table |
| `src/app/(dashboard)/runs/runs-filter.tsx` | "use client" -- status filter |
| `src/app/(dashboard)/runs/[runId]/page.tsx` | Server component -- fetches run + first events page |
| `src/app/(dashboard)/runs/[runId]/run-header.tsx` | Run metadata display |
| `src/app/(dashboard)/runs/[runId]/event-timeline.tsx` | "use client" -- paginated event list |
| `src/app/(dashboard)/runs/[runId]/event-detail.tsx` | "use client" -- expandable event card |

### 7.6 Policies Pages

| File | Description |
|---|---|
| `src/app/(dashboard)/policies/page.tsx` | Server component -- fetches policy list |
| `src/app/(dashboard)/policies/policy-list.tsx` | "use client" -- paginated cards |
| `src/app/(dashboard)/policies/new/page.tsx` | Create policy page |
| `src/app/(dashboard)/policies/[id]/edit/page.tsx` | Edit policy page |
| `src/app/(dashboard)/policies/policy-editor.tsx` | "use client" -- JSON editor + validation |
| `src/app/(dashboard)/policies/conflict-dialog.tsx` | "use client" -- optimistic concurrency conflict |

### 7.7 API Keys Page

| File | Description |
|---|---|
| `src/app/(dashboard)/api-keys/page.tsx` | Server component -- fetches key list |
| `src/app/(dashboard)/api-keys/api-key-table.tsx` | "use client" -- key list with revoke |
| `src/app/(dashboard)/api-keys/create-key-dialog.tsx` | "use client" -- create + one-time display |

### 7.8 Supervisor Page

| File | Description |
|---|---|
| `src/app/(dashboard)/supervisor/page.tsx` | Server component -- fetches proposals + escalations |
| `src/app/(dashboard)/supervisor/proposal-queue.tsx` | "use client" -- proposal list |
| `src/app/(dashboard)/supervisor/proposal-card.tsx` | "use client" -- single proposal + actions |
| `src/app/(dashboard)/supervisor/escalation-queue.tsx` | "use client" -- escalation list |
| `src/app/(dashboard)/supervisor/escalation-card.tsx` | "use client" -- single escalation + actions |

### 7.9 Settings Page (Stub)

| File | Description |
|---|---|
| `src/app/(dashboard)/settings/page.tsx` | Placeholder for future tenant settings |

### 7.10 Shared Components

| File | Description |
|---|---|
| `src/components/ui/decision-badge.tsx` | Decision type pill (server) |
| `src/components/ui/status-badge.tsx` | Run status pill (server) |
| `src/components/ui/severity-badge.tsx` | Escalation severity pill (server) |
| `src/components/ui/chain-badge.tsx` | "use client" -- chain verification shield |
| `src/components/ui/time-ago.tsx` | "use client" -- relative timestamp |
| `src/components/ui/load-more.tsx` | "use client" -- pagination button |
| `src/components/ui/empty-state.tsx` | Empty state placeholder (server) |
| `src/components/ui/copy-button.tsx` | "use client" -- click-to-copy |
| `src/components/ui/confirm-dialog.tsx` | "use client" -- confirmation modal |
| `src/components/ui/json-viewer.tsx` | "use client" -- collapsible JSON |
| `src/components/ui/budget-bar.tsx` | Budget progress bar (server) |
| `src/components/ui/page-header.tsx` | Page title + actions (server) |

### 7.11 Test Files

| File | Description |
|---|---|
| `tests/e2e/auth.spec.ts` | Playwright -- sign-in, sign-up, sign-out |
| `tests/e2e/runs.spec.ts` | Playwright -- runs list, run detail, pagination |
| `tests/e2e/policies.spec.ts` | Playwright -- create, edit, version conflict |
| `tests/e2e/api-keys.spec.ts` | Playwright -- create, copy, revoke |
| `tests/e2e/supervisor.spec.ts` | Playwright -- approve, reject, acknowledge |
| `playwright.config.ts` | Playwright config |

---

## 8. tRPC Client Setup

### 8.1 Server-Side Client (`src/lib/trpc-server.ts`)

```
// Pattern (not implementation):
import type { AppRouter } from "@loopstorm/api";
import { createTRPCClient, httpBatchLink } from "@trpc/client";
import { headers, cookies } from "next/headers";

// Create a per-request client that forwards cookies for session auth.
// The client targets /api/trpc (proxied to backend in dev,
// or the absolute backend URL in production).
```

Key points:
- Use `httpBatchLink` to batch multiple tRPC calls per request.
- Forward the `Cookie` header from the incoming request so Better Auth
  session cookies reach the backend.
- The backend URL comes from `process.env.NEXT_PUBLIC_API_URL` (or
  defaults to the relative `/api/trpc` path which the Next.js proxy
  rewrites to the backend in development).

### 8.2 Client-Side Client (`src/lib/trpc-client.ts`)

```
// Pattern:
import { createTRPCReact } from "@trpc/react-query";
import type { AppRouter } from "@loopstorm/api";

export const trpc = createTRPCReact<AppRouter>();
```

### 8.3 Provider (`src/lib/trpc-provider.tsx`)

```
// Pattern:
"use client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink } from "@trpc/client";
import { trpc } from "./trpc-client";

// Create QueryClient and tRPC client in a useState to avoid
// re-creation on re-render. Configure credentials: "include"
// for cookie-based auth.
```

---

## 9. Auth Flow

### 9.1 Sign-In

1. User navigates to `/sign-in`.
2. `AuthForm` component renders email/password inputs and a Google OAuth button.
3. Email sign-in: calls `authClient.signIn.email({ email, password })`.
4. Google sign-in: calls `authClient.signIn.social({ provider: "google" })`.
5. On success, Better Auth sets a session cookie.
6. The client redirects to `/runs` (dashboard).

### 9.2 Sign-Up

1. User navigates to `/sign-up`.
2. `AuthForm` component renders name, email, password inputs.
3. Calls `authClient.signUp.email({ name, email, password })`.
4. Better Auth creates the user and sends a verification email
   (if `requireEmailVerification` is enabled on the backend).
5. On success, redirect to `/sign-in` with a "check your email" message.

### 9.3 Session Management

- The dashboard layout (`(dashboard)/layout.tsx`) checks for a valid session.
- If no session, redirect to `/sign-in`.
- Session check uses the server-side tRPC client (which forwards cookies)
  or a lightweight `GET /api/auth/get-session` call.
- The `DashboardHeader` shows the user's name and a sign-out button.
- Sign-out calls `authClient.signOut()` and redirects to `/sign-in`.

### 9.4 Auth Guard Pattern

The dashboard layout uses a server-side auth check:

```
// Pattern for (dashboard)/layout.tsx:
// 1. Read cookies from the request
// 2. Call backend /api/auth/get-session with those cookies
// 3. If no valid session -> redirect("/sign-in")
// 4. Otherwise -> render children with tenant context
```

This runs on every navigation to a dashboard page. The 5-minute cookie
cache configured in the backend (auth.ts) means most checks resolve from
the cached cookie without hitting the database.

---

## 10. Page Specifications

### 10.1 Runs List (`/runs`)

**Data**: `trpc.runs.list({ limit: 50, status? })`

**Layout**:
- `PageHeader`: "Runs" title
- `RunsFilter`: dropdown for status filter (all, started, completed, terminated_*)
- `RunsTable`: columns = Agent Name, Agent Role, Status, Decisions, Cost, Duration, Started
  - Agent Name: `agent_name` or "Unknown"
  - Status: `StatusBadge` component
  - Decisions: `total_call_count` number
  - Cost: `$X.XXXX` formatted from `total_cost_usd`
  - Duration: computed from `started_at` to `ended_at` (or "running" if no `ended_at`)
  - Started: `TimeAgo` component showing `started_at`
- Row click navigates to `/runs/[runId]`
- `LoadMoreButton` at bottom when `nextCursor` is present

### 10.2 Run Detail (`/runs/[runId]`)

**Data**:
- `trpc.runs.get({ run_id })` for run metadata
- `trpc.runs.getEvents({ run_id, limit: 100 })` for event timeline
- `trpc.verify.chain({ run_id })` for chain verification (lazy, client-side)

**Layout**:
- `RunHeader`:
  - Agent name, role, environment, policy pack ID
  - `StatusBadge` for run status
  - `ChainBadge` -- calls verify.chain on mount, shows verified/broken/pending
  - Budget summary: 4 `BudgetBar` components (cost, input tokens, output tokens, calls)
    - Only shown if the run has budget data
    - Percentage fill computed from run totals vs. policy budget caps
  - Duration, started_at, ended_at timestamps
- `EventTimeline`:
  - Vertical timeline with dots colored by decision type
  - Each event shows: seq, timestamp, event_type, tool, decision badge
  - Expandable: click to show `EventDetail` with args_redacted (via `JsonViewer`),
    rule_id, reason, model, tokens, cost, latency
  - `LoadMoreButton` for pagination (cursor = last seq)

### 10.3 Policies List (`/policies`)

**Data**: `trpc.policies.list({ limit: 50 })`

**Layout**:
- `PageHeader`: "Policies" title + "Create Policy" button
- `PolicyList`: cards showing name, description, agent_role, environment,
  is_active badge, version number, updated_at
- Card click navigates to `/policies/[id]/edit`
- `LoadMoreButton` for pagination

### 10.4 Policy Create (`/policies/new`)

**Data**: none (form submission calls `trpc.policies.create`)

**Layout**:
- `PageHeader`: "Create Policy" title
- Form fields: name (text), description (textarea), agent_role (text),
  environment (text), is_active (toggle)
- `PolicyEditor`: textarea for JSON content with:
  - Line numbers
  - Syntax error highlighting (basic JSON.parse check)
  - Server-side validation errors displayed inline
  - Character count
- Submit button calls `trpc.policies.create` and navigates to the
  policy list on success

### 10.5 Policy Edit (`/policies/[id]/edit`)

**Data**: `trpc.policies.get({ id })`

**Layout**: Same as create, but pre-filled. Key difference:

- **Optimistic concurrency**: the form captures `version` when the policy
  is loaded. On submit, passes `version` to `trpc.policies.update`.
  - If the backend returns CONFLICT (409), show `ConflictDialog`:
    - "This policy was modified by another user."
    - Options: "Re-fetch and edit" (reloads), "Overwrite" (re-submits
      with new version -- this requires re-fetching the current version
      and then updating).
  - The dialog shows the current version number and who/when it was
    last modified.

### 10.6 API Keys (`/api-keys`)

**Data**: `trpc.apiKeys.list({ limit: 50 })`

**Layout**:
- `PageHeader`: "API Keys" title + "Create Key" button
- `ApiKeyTable`: columns = Name, Prefix, Scopes, Last Used, Expires, Status
  - Prefix: `key_prefix` in monospace font (e.g., `lsg_a1b2`)
  - Scopes: comma-separated tags
  - Last Used: `TimeAgo` or "Never"
  - Expires: date or "Never"
  - Status: Active / Revoked / Expired
  - Revoke button (with confirm dialog) on each active row

- `CreateKeyDialog` (modal):
  - Form: name (text), scopes (checkboxes: ingest, read), expiry (optional days)
  - On submit, calls `trpc.apiKeys.create`
  - **One-time key display**: the response `key` field is shown in a
    prominent, monospace, copy-to-clipboard box with a warning:
    "Copy this key now. It will not be shown again."
  - `CopyButton` copies to clipboard
  - Dialog cannot be dismissed until the user clicks "I've copied this key"

### 10.7 Supervisor (`/supervisor`)

**Data**:
- `trpc.supervisor.listProposals({ status: "pending", limit: 20 })`
- `trpc.supervisor.listEscalations({ status: "open", limit: 20 })`

**Layout**: Two sections, escalations first (higher urgency).

**Escalation Queue** (top section):
- `PageHeader`: "Escalations" with count badge
- `EscalationCard` for each open escalation:
  - `SeverityBadge` (critical = pulsing animation)
  - Rationale text
  - Recommendation text
  - Confidence score (0-1 as percentage)
  - Timeout countdown (if `timeout_seconds` set)
  - "Acknowledge" button (opens form for optional resolution notes)
  - Calls `trpc.supervisor.acknowledgeEscalation`

**Proposal Queue** (bottom section):
- `PageHeader`: "Proposals" with count badge
- Filter tabs: Pending | Approved | Rejected | All
- `ProposalCard` for each proposal:
  - Proposal type badge (budget_adjustment, policy_change, etc.)
  - Target agent
  - Rationale text
  - Confidence score
  - Supporting runs (linked to run detail pages)
  - "Approve" button (calls `trpc.supervisor.approveProposal`)
  - "Reject" button (opens form for required rejection reason, calls
    `trpc.supervisor.rejectProposal`)

---

## 11. Error Handling

### 11.1 tRPC Error Mapping

| tRPC Code | User-Facing Behavior |
|---|---|
| `UNAUTHORIZED` | Redirect to `/sign-in` |
| `FORBIDDEN` | "You do not have access to this resource" |
| `NOT_FOUND` | "Not found" with back link |
| `BAD_REQUEST` | Show validation errors inline |
| `CONFLICT` | Show conflict dialog (policies) or retry message |
| `INTERNAL_SERVER_ERROR` | "Something went wrong. Please try again." |

### 11.2 Error Boundaries

Each page section has a React error boundary (`error.tsx` files in each
route). The error boundary displays the error message and a "Retry" button.

### 11.3 Loading States

Each page has a `loading.tsx` file that renders a skeleton/shimmer version
of the page layout. This provides immediate visual feedback during
server-side data fetching.

---

## 12. Dependencies to Add

### 12.1 Production Dependencies

| Package | Version | Purpose |
|---|---|---|
| `@trpc/client` | `^11.0.0` | tRPC vanilla client |
| `@trpc/react-query` | `^11.0.0` | tRPC React Query integration |
| `@tanstack/react-query` | `^5.0.0` | Server state management |
| `better-auth` | `^1.2.5` | Auth client SDK (must match backend) |
| `@loopstorm/schemas` | `*` | Shared types (workspace dep) |

### 12.2 Dependencies to Remove

| Package | Reason |
|---|---|
| `@supabase/supabase-js` | Stale -- we use Better Auth + tRPC, never Supabase client |

### 12.3 Dev Dependencies

| Package | Version | Purpose |
|---|---|---|
| `@playwright/test` | `^1.49.0` | E2E testing |
| `tailwindcss` | `^4.0.0` | Utility-first CSS |
| `@tailwindcss/postcss` | `^4.0.0` | PostCSS plugin for Tailwind v4 |

**Note on Tailwind v4**: Tailwind v4 no longer uses a `tailwind.config.js`
file. Configuration is done in CSS using `@theme` directives in `globals.css`.
The PostCSS plugin (`@tailwindcss/postcss`) is the integration mechanism.

---

## 13. Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `NEXT_PUBLIC_API_URL` | No | `""` (relative, uses proxy) | Backend API URL. Empty = use Next.js rewrites |
| `NEXT_PUBLIC_BETTER_AUTH_URL` | No | `""` (relative) | Better Auth base URL. Used by auth client |

In development, both default to empty string (relative paths), which
routes through the Next.js rewrite proxy to `http://localhost:3001`.

In production, set to the absolute backend URL
(e.g., `https://api.loop-storm.com`).

---

## 14. Testing Strategy

### 14.1 Playwright E2E Tests

E2E tests run against the full stack (Next.js frontend + Hono backend +
PostgreSQL database). They verify user-visible behavior, not implementation.

**Test environment**:
- Backend running on `localhost:3001` with a test database
- Frontend running on `localhost:3000`
- Playwright configured in `playwright.config.ts`

**Test categories**:

| Test File | Scenarios |
|---|---|
| `auth.spec.ts` | Sign up, verify email, sign in, sign out, invalid credentials, Google OAuth redirect |
| `runs.spec.ts` | Runs list loads, pagination works, status filter works, run detail shows events, chain badge shows verified |
| `policies.spec.ts` | Create policy, edit policy, version conflict displays dialog, validation errors shown |
| `api-keys.spec.ts` | Create key shows one-time display, copy button works, revoke works, revoked key shows status |
| `supervisor.spec.ts` | Approve proposal, reject proposal (requires reason), acknowledge escalation |

### 14.2 Unit/Component Tests (Deferred)

Component-level tests (Vitest + React Testing Library) are deferred to a
follow-up PR. The E2E tests cover the critical user paths for v1.

### 14.3 Typecheck as Test

`tsc --noEmit` catches type mismatches between the frontend and backend.
Since the tRPC client infers types from `AppRouter`, any backend procedure
signature change that breaks the frontend will fail `typecheck`. This is
enforced in CI.

---

## 15. Backend Issues Found During Review

The following issues were identified in the backend code during this review.
They do NOT block P4 (the frontend can work around them), but should be
addressed in a follow-up PR.

### 15.1 Missing Registration Tenant Flow

The backend `auth.ts` has a comment referencing `auth-hooks.ts` for
post-registration tenant creation, but this file does not exist. When a
new user signs up, there is no mechanism to:
1. Create a `tenants` row
2. Set `users.tenant_id` to the new tenant's ID

**Impact on P4**: The sign-up flow will create a user in Better Auth, but
the user will have `tenant_id = null`. The tRPC auth middleware will throw
FORBIDDEN ("No tenant associated with this account") on the first
authenticated request.

**Workaround for P4**: The frontend can display a "Setting up your account..."
state and the backend team should add the tenant creation hook in a follow-up.
Alternatively, seed a test tenant and user for E2E tests.

**Recommendation**: File a P3.1 follow-up to implement the post-registration
hook that creates the tenant automatically.

### 15.2 CORS origin for production

The backend's CORS config defaults to `["http://localhost:3000"]`. In
production, `ALLOWED_ORIGINS` must be set to include the Vercel deployment
URL. This is a deployment-time concern, not a code change.

---

## 16. Backend Changes Required: NONE

This task brief specifies **zero backend code changes**. The frontend
consumes the existing tRPC API exactly as-is. If the frontend agent
discovers a blocker (e.g., missing procedure, wrong return type), they must
raise it to the lead architect for gate resolution rather than modifying
backend code.

---

## 17. Acceptance Criteria

| # | Criterion | Verification |
|---|---|---|
| AC1 | `bun run typecheck` passes in `packages/web/` | CI |
| AC2 | `bun run lint` passes in `packages/web/` | CI |
| AC3 | `bun run build` succeeds in `packages/web/` | CI |
| AC4 | Every `.ts`/`.tsx`/`.css` file has `// SPDX-License-Identifier: AGPL-3.0-only` | CI license check |
| AC5 | Sign-in page renders and submits email+password | Playwright |
| AC6 | Runs list loads and displays status badges | Playwright |
| AC7 | Run detail shows event timeline with decision badges | Playwright |
| AC8 | Chain verification badge appears on run detail | Playwright |
| AC9 | Policy create validates content and shows errors | Playwright |
| AC10 | Policy edit shows conflict dialog on version mismatch | Playwright |
| AC11 | API key create shows one-time key with copy button | Playwright |
| AC12 | API key revoke works and shows revoked status | Playwright |
| AC13 | Supervisor proposal approve/reject works | Playwright |
| AC14 | Supervisor escalation acknowledge works | Playwright |
| AC15 | No `@supabase/supabase-js` import anywhere in `packages/web/` | Grep check |
| AC16 | No import of `appRouter` value (only `AppRouter` type) | Grep check |
| AC17 | Decision badges use consistent semantic colors | Visual review |
| AC18 | Dashboard sidebar navigates correctly between all pages | Playwright |
| AC19 | Unauthenticated access to dashboard pages redirects to sign-in | Playwright |

---

## 18. Out of Scope (Explicitly Deferred)

| Feature | Deferred To | Reason |
|---|---|---|
| Supabase Realtime subscriptions | P4.1 or v2 | Requires JWT bridge (ADR-011 consequence) |
| Mobile-responsive layout | v2 | Developer tool, desktop-first |
| Dark mode | v2 | Nice-to-have, not v1 critical |
| Component-level unit tests | P4.1 | E2E covers critical paths for v1 |
| Tenant settings page | v2 | Stub route only in v1 |
| Run comparison / diff view | v2 | Advanced feature |
| Export / download audit logs | v2 | CLI covers this for v1 |
| Policy version history / diff | v2 | Version counter is in the DB, but UI diff is deferred |
| Notification system (email/push) | v2 / Mode 3 | Part of the mobile approval app roadmap |
| `filter` and `import` CLI features | P5 | Not dashboard features |

---

## 19. Implementation Order

The implementing agent should build in this order to ensure incremental
progress with working intermediate states:

1. **Package setup**: Clean package.json, add deps, create next.config.ts,
   postcss.config.mjs, globals.css with tokens.
2. **tRPC client setup**: trpc-server.ts, trpc-client.ts, trpc-provider.tsx.
3. **Auth client setup**: auth-client.ts, env.ts.
4. **Root layout + providers**: Update layout.tsx, add TRPCProvider.
5. **Auth pages**: (auth)/layout.tsx, sign-in, sign-up, AuthForm.
6. **Dashboard layout**: (dashboard)/layout.tsx, sidebar, header, auth guard.
7. **Shared components**: All `src/components/ui/` components.
8. **Runs pages**: List + detail + timeline.
9. **Policies pages**: List + create + edit + conflict dialog.
10. **API keys page**: List + create dialog.
11. **Supervisor page**: Proposals + escalations.
12. **Playwright tests**: All 5 test files.
13. **CI verification**: typecheck, lint, build all pass.
