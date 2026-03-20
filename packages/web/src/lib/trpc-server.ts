// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Vanilla tRPC client for server components.
 *
 * Creates a per-request tRPC client that forwards the incoming request's
 * cookies so Better Auth session tokens are passed to the backend.
 *
 * Usage in server components:
 *   import { createServerTRPCClient } from "@/lib/trpc-server";
 *   const trpc = await createServerTRPCClient();
 *   const runs = await trpc.runs.list({ limit: 50 });
 *
 * IMPORTANT: Only import the AppRouter TYPE — never import the actual
 * appRouter value from @loopstorm/api.
 */

import type { AppRouter } from "@loopstorm/api";
import { createTRPCClient, httpBatchLink } from "@trpc/client";
import { cookies } from "next/headers";
import { getTRPCUrl } from "./env";

/**
 * Creates a new tRPC client for use in a single server component render.
 *
 * This must be called inside a server component or server action —
 * it calls `cookies()` from next/headers which requires the request context.
 */
export async function createServerTRPCClient() {
  const cookieStore = await cookies();
  const cookieHeader = cookieStore.toString();

  return createTRPCClient<AppRouter>({
    links: [
      httpBatchLink({
        url: getTRPCUrl(),
        headers() {
          return {
            cookie: cookieHeader,
          };
        },
      }),
    ],
  });
}
