// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Root tRPC router for LoopStorm Guard.
 *
 * Merges all sub-routers into the single `appRouter` that is mounted
 * in `src/index.ts`. The exported `AppRouter` type is consumed by the
 * frontend package for end-to-end type safety.
 *
 * Router namespaces:
 * - `runs`             — list, get, getEvents
 * - `events`           — ingest
 * - `policies`         — list, get, create, update
 * - `supervisor`       — listProposals, approveProposal, rejectProposal,
 *                        listEscalations, acknowledgeEscalation, resolveEscalation
 * - `supervisorTools`  — getRunEvents, getAgentBaseline, getPolicyPack,
 *                        querySimilarRuns, createProposal, createEscalation,
 *                        recordLearning (API key auth, supervisor scope)
 * - `verify`           — chain
 * - `apiKeys`          — list, create, revoke
 *
 * IMPORTANT: After Phase E (frontend integration) is merged, do NOT change
 * any procedure signatures without coordinating with the frontend-senior-engineer
 * agent. Signature changes are breaking changes for the frontend type inference.
 */

import { apiKeysRouter } from "./routers/api-keys.js";
import { eventsRouter } from "./routers/events.js";
import { policiesRouter } from "./routers/policies.js";
import { runsRouter } from "./routers/runs.js";
import { supervisorToolsRouter } from "./routers/supervisor-tools.js";
import { supervisorRouter } from "./routers/supervisor.js";
import { verifyRouter } from "./routers/verify.js";
import { router } from "./trpc.js";

/**
 * The root application router.
 *
 * All tRPC procedures are namespaced under their respective sub-routers.
 * This is the single source of truth for the tRPC API surface.
 */
export const appRouter = router({
  /** Agent run management — list, get, getEvents */
  runs: runsRouter,

  /** JSONL event ingest from SDK agents */
  events: eventsRouter,

  /** Policy pack management — list, get, create, update */
  policies: policiesRouter,

  /** AI Supervisor observation plane — proposals and escalations */
  supervisor: supervisorRouter,

  /** AI Supervisor tool APIs — API key auth with supervisor scope */
  supervisorTools: supervisorToolsRouter,

  /** Hash chain verification for audit trail integrity */
  verify: verifyRouter,

  /** API key management — list, create, revoke */
  apiKeys: apiKeysRouter,
});

/**
 * The inferred TypeScript type of the root router.
 *
 * Export this type from the backend package so the frontend can import it
 * for tRPC client type inference:
 *
 * @example
 * ```typescript
 * // packages/web/src/lib/trpc.ts
 * import type { AppRouter } from "@loopstorm/api";
 * const client = createTRPCClient<AppRouter>({ ... });
 * ```
 *
 * The frontend must NEVER import the actual `appRouter` value — only this type.
 * Importing the value would pull in all backend dependencies (Drizzle, postgres.js,
 * Better Auth) into the frontend bundle, violating the package boundary.
 */
export type AppRouter = typeof appRouter;
