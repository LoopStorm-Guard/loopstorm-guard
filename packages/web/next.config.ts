// SPDX-License-Identifier: AGPL-3.0-only
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * Development proxy rewrites: forward /api/auth/** and /api/trpc/**
   * to the backend running on localhost:3001.
   *
   * In production, NEXT_PUBLIC_API_URL is set to the absolute backend URL
   * and the tRPC client calls it directly (no rewrite needed).
   */
  async rewrites() {
    // Only apply rewrites in development (when no explicit API URL is set)
    const apiUrl = process.env.NEXT_PUBLIC_API_URL;
    if (apiUrl) {
      return [];
    }

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
  },
};

export default nextConfig;
