// SPDX-License-Identifier: AGPL-3.0-only
/**
 * SidebarNav — sidebar navigation with active link highlighting.
 *
 * Client component because it uses usePathname() to highlight active links.
 */

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const navItems = [
  { href: "/runs", label: "Runs", icon: "▶" },
  { href: "/policies", label: "Policies", icon: "◈" },
  { href: "/api-keys", label: "API Keys", icon: "⚷" },
  { href: "/supervisor", label: "Supervisor", icon: "◎" },
  { href: "/settings", label: "Settings", icon: "⚙" },
];

export function SidebarNav() {
  const pathname = usePathname();

  return (
    <nav
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "0.125rem",
        padding: "0.5rem",
      }}
    >
      {navItems.map((item) => {
        const isActive = pathname === item.href || pathname.startsWith(item.href + "/");
        return (
          <Link
            key={item.href}
            href={item.href}
            data-testid={`nav-${item.label.toLowerCase().replace(/\s+/g, "-")}`}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.625rem",
              padding: "0.5rem 0.75rem",
              borderRadius: "0.375rem",
              fontSize: "0.875rem",
              fontWeight: isActive ? "500" : "400",
              color: isActive ? "oklch(0.92 0.00 0)" : "oklch(0.60 0.00 0)",
              backgroundColor: isActive ? "rgba(255, 107, 0, 0.1)" : "transparent",
              borderLeft: isActive
                ? "2px solid var(--color-accent-amber)"
                : "2px solid transparent",
              textDecoration: "none",
              transition: "all 0.1s ease",
            }}
          >
            <span style={{ fontSize: "0.875rem", opacity: 0.8 }}>{item.icon}</span>
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
