// SPDX-License-Identifier: MIT
/**
 * tRPC HTTP client for supervisor → backend communication.
 *
 * AGPL/MIT boundary: This imports only the AppRouter TYPE from @loopstorm/api.
 * The backend value code is never bundled. Communication is over HTTP.
 *
 * Spec reference: specs/task-briefs/v1.1-ai-supervisor.md, Task SUP-B4.
 */

import type { AppRouter } from "@loopstorm/api";
import { createTRPCClient, httpBatchLink } from "@trpc/client";

/**
 * Create a type-safe tRPC client for the backend.
 *
 * @param backendUrl - Backend base URL (e.g., "http://localhost:3001")
 * @param apiKey     - API key with "supervisor" scope
 */
export function createBackendClient(backendUrl: string, apiKey: string) {
  return createTRPCClient<AppRouter>({
    links: [
      httpBatchLink({
        url: `${backendUrl}/api/trpc`,
        headers: () => ({ authorization: `Bearer ${apiKey}` }),
      }),
    ],
  });
}

export type BackendClient = ReturnType<typeof createBackendClient>;
