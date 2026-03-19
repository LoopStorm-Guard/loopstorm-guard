// SPDX-License-Identifier: AGPL-3.0-only
/**
 * UserMenu — dropdown with user info and sign-out button.
 *
 * Client component because it uses useSession() and signOut().
 */

"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { signOut, useSession } from "@/lib/auth-client";

export function UserMenu() {
  const router = useRouter();
  const { data: session } = useSession();
  const [loading, setLoading] = useState(false);

  async function handleSignOut() {
    setLoading(true);
    try {
      await signOut();
      router.push("/sign-in");
    } catch {
      setLoading(false);
    }
  }

  const userEmail = session?.user?.email ?? "";
  const userName = session?.user?.name ?? userEmail.split("@")[0] ?? "User";
  const initials = userName
    .split(" ")
    .map((n: string) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  return (
    <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
      <div
        style={{
          width: "1.75rem",
          height: "1.75rem",
          borderRadius: "50%",
          backgroundColor: "rgba(155, 109, 255, 0.2)",
          border: "1px solid rgba(155, 109, 255, 0.4)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: "0.625rem",
          fontWeight: "600",
          color: "var(--color-accent-purple)",
          flexShrink: 0,
        }}
      >
        {initials}
      </div>
      <span
        style={{
          fontSize: "0.8125rem",
          color: "oklch(0.70 0.00 0)",
          maxWidth: "8rem",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {userName}
      </span>
      <button
        type="button"
        onClick={handleSignOut}
        disabled={loading}
        data-testid="btn-sign-out"
        style={{
          padding: "0.25rem 0.5rem",
          backgroundColor: "transparent",
          border: "1px solid var(--color-border)",
          borderRadius: "0.25rem",
          color: "oklch(0.55 0.00 0)",
          fontSize: "0.75rem",
          cursor: loading ? "not-allowed" : "pointer",
          opacity: loading ? 0.7 : 1,
        }}
      >
        {loading ? "…" : "Sign out"}
      </button>
    </div>
  );
}
