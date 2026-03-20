// SPDX-License-Identifier: AGPL-3.0-only
/**
 * TimeAgo — displays a relative timestamp (e.g. "2m ago", "3h ago").
 *
 * Client component because it renders time relative to now, which changes.
 * Updates every minute. Shows the absolute date in the title attribute as
 * a tooltip for accessibility.
 */

"use client";

import { useEffect, useState } from "react";

interface TimeAgoProps {
  date: Date | string | null | undefined;
  fallback?: string;
}

function formatRelative(date: Date): string {
  const now = Date.now();
  const diff = now - date.getTime();
  const seconds = Math.floor(diff / 1000);

  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString();
}

export function TimeAgo({ date, fallback = "Never" }: TimeAgoProps) {
  const [, setTick] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => setTick((t) => t + 1), 60_000);
    return () => clearInterval(interval);
  }, []);

  if (!date) {
    return <span style={{ color: "oklch(0.50 0.00 0)" }}>{fallback}</span>;
  }

  const dateObj = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(dateObj.getTime())) {
    return <span style={{ color: "oklch(0.50 0.00 0)" }}>{fallback}</span>;
  }

  return (
    <time
      dateTime={dateObj.toISOString()}
      title={dateObj.toLocaleString()}
      style={{ color: "oklch(0.60 0.00 0)", fontSize: "inherit" }}
    >
      {formatRelative(dateObj)}
    </time>
  );
}
