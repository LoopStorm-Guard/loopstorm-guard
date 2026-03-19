// SPDX-License-Identifier: AGPL-3.0-only
/**
 * tRPC + React Query provider for the LoopStorm Guard web UI.
 *
 * Wraps the app with QueryClientProvider (TanStack Query) and the
 * tRPC React provider. This enables client components to use the
 * trpc.xxx.useQuery() hooks.
 *
 * Mounted once in the root layout. All client components beneath it
 * can access the tRPC client via the trpc import from trpc-client.ts.
 */

"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink } from "@trpc/client";
import { useState } from "react";
import { getTRPCUrl } from "./env";
import { trpc } from "./trpc-client";

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // With SSR, we usually want staleTime > 0 to avoid refetching
        // immediately on the client after server-side render
        staleTime: 30 * 1000, // 30 seconds
        retry: 1,
      },
    },
  });
}

let browserQueryClient: QueryClient | undefined;

function getQueryClient() {
  if (typeof window === "undefined") {
    // Server: always make a new query client
    return makeQueryClient();
  }
  // Browser: use a singleton to avoid re-creating on every render
  if (!browserQueryClient) {
    browserQueryClient = makeQueryClient();
  }
  return browserQueryClient;
}

interface TRPCProviderProps {
  children: React.ReactNode;
}

export function TRPCProvider({ children }: TRPCProviderProps) {
  const queryClient = getQueryClient();

  const [trpcClient] = useState(() =>
    trpc.createClient({
      links: [
        httpBatchLink({
          url: getTRPCUrl(),
          fetch(url, options) {
            return fetch(url, {
              ...options,
              credentials: "include",
            });
          },
        }),
      ],
    })
  );

  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </trpc.Provider>
  );
}
