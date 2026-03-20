// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Dashboard layout — sidebar + header + auth guard.
 *
 * Checks for a valid session on every navigation. Redirects to /sign-in
 * if the user is not authenticated.
 *
 * Session check is server-side: reads cookies from the request and calls
 * the Better Auth /api/auth/get-session endpoint.
 */

import { DashboardHeader } from "@/components/layout/dashboard-header";
import { SidebarNav } from "@/components/layout/sidebar-nav";
import { getAuthBaseURL } from "@/lib/env";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

async function getSession() {
  try {
    const cookieStore = await cookies();
    const cookieHeader = cookieStore.toString();
    const baseURL = getAuthBaseURL();
    const url = baseURL
      ? `${baseURL}/api/auth/get-session`
      : "http://localhost:3001/api/auth/get-session";

    const res = await fetch(url, {
      headers: { cookie: cookieHeader },
      cache: "no-store",
    });

    if (!res.ok) return null;
    const data = await res.json();
    return data ?? null;
  } catch {
    return null;
  }
}

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();

  if (!session || !session.user) {
    redirect("/sign-in");
  }

  return (
    <div style={{ display: "flex", minHeight: "100vh" }}>
      {/* Sidebar */}
      <aside
        style={{
          width: "var(--sidebar-width)",
          backgroundColor: "var(--color-surface)",
          borderRight: "1px solid var(--color-border)",
          position: "fixed",
          top: 0,
          left: 0,
          bottom: 0,
          display: "flex",
          flexDirection: "column",
          zIndex: 20,
        }}
      >
        {/* Sidebar brand */}
        <div
          style={{
            height: "var(--header-height)",
            display: "flex",
            alignItems: "center",
            padding: "0 1rem",
            borderBottom: "1px solid var(--color-border)",
          }}
        >
          <span
            style={{
              fontSize: "0.875rem",
              fontWeight: "600",
              color: "oklch(0.85 0.00 0)",
            }}
          >
            LoopStorm
          </span>
          <span
            style={{
              marginLeft: "0.375rem",
              fontSize: "0.75rem",
              color: "var(--color-accent-amber)",
              fontFamily: "var(--font-mono)",
            }}
          >
            Guard
          </span>
        </div>

        {/* Navigation */}
        <SidebarNav />

        {/* Sidebar footer */}
        <div
          style={{
            marginTop: "auto",
            padding: "0.75rem 1rem",
            borderTop: "1px solid var(--color-border)",
          }}
        >
          <span
            style={{
              fontSize: "0.6875rem",
              color: "oklch(0.40 0.00 0)",
              fontFamily: "var(--font-mono)",
            }}
          >
            v0.1.0
          </span>
        </div>
      </aside>

      {/* Main content area */}
      <div
        style={{
          marginLeft: "var(--sidebar-width)",
          flex: 1,
          display: "flex",
          flexDirection: "column",
        }}
      >
        <DashboardHeader />

        {/* Page content */}
        <main
          style={{
            marginTop: "var(--header-height)",
            flex: 1,
            padding: "1.5rem",
            maxWidth: "var(--page-max-width)",
            width: "100%",
          }}
        >
          {children}
        </main>
      </div>
    </div>
  );
}
