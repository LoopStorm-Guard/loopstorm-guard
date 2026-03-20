// SPDX-License-Identifier: AGPL-3.0-only
/**
 * tRPC React Query client for client components.
 *
 * Use this in "use client" components that need reactive data fetching,
 * optimistic updates, or React Query cache invalidation.
 *
 * For server components, use the vanilla client from trpc-server.ts instead.
 *
 * IMPORTANT: Only import the AppRouter TYPE — never import the actual
 * appRouter value from @loopstorm/api. Importing the value would pull
 * all backend dependencies (Drizzle, postgres.js, Better Auth) into
 * the frontend bundle.
 */

import type { AppRouter } from "@loopstorm/api";
import { createTRPCReact } from "@trpc/react-query";

/**
 * The tRPC React Query client.
 *
 * Used with useTRPC() hook or trpc.xxx.useQuery() in client components.
 *
 * Configured with credentials: "include" in the provider so Better Auth
 * session cookies are forwarded on every request.
 */
export const trpc = createTRPCReact<AppRouter>();
