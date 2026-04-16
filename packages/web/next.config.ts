// SPDX-License-Identifier: AGPL-3.0-only
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * Redirect dashboard root to /runs (was previously done in
   * (dashboard)/page.tsx but that caused a missing
   * page_client-reference-manifest.js error on Vercel).
   */
  async redirects() {
    return [
      {
        source: "/",
        has: [{ type: "cookie", key: "better-auth.session_token" }],
        destination: "/runs",
        permanent: false,
      },
    ];
  },

  /**
   * Proxy rewrites for auth and (in dev) tRPC.
   *
   * Auth is ALWAYS proxied through Next.js — in both development and
   * production. This ensures that Better Auth session cookies are set on
   * app.loop-storm.com (the frontend domain) rather than api.loop-storm.com
   * (the backend domain). Without this, Next.js server components cannot
   * read the session cookie via cookies(), causing every dashboard visit to
   * redirect back to /sign-in even when the user is authenticated.
   *
   * tRPC is only proxied in development; in production the client calls
   * the backend URL directly.
   */
  async rewrites() {
    const apiUrl = process.env.NEXT_PUBLIC_API_URL;

    if (!apiUrl) {
      // Local dev: proxy both auth and tRPC to localhost:3001
      return [
        {
          source: "/api/auth/:path*",
          destination: "http://localhost:3001/api/auth/:path*",
        },
        {
          source: "/api/trpc/:path*",
          destination: "http://localhost:3001/api/trpc/:path*",
        },
      ];
    }

    // Production: proxy auth through Next.js so session cookies land on
    // app.loop-storm.com and are readable by server components.
    return [
      {
        source: "/api/auth/:path*",
        destination: `${apiUrl}/api/auth/:path*`,
      },
    ];
  },
};

export default nextConfig;
