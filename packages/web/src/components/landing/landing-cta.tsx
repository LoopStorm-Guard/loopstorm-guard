// SPDX-License-Identifier: AGPL-3.0-only
/**
 * LandingCTA — auth-aware call-to-action buttons for the landing page hero.
 *
 * Client component: reads the Better Auth session to decide whether to show
 * "Go to Dashboard" (authenticated) or "Get Started / Sign In" (guest).
 */

"use client";

import { useSession } from "@/lib/auth-client";
import Link from "next/link";

const primaryBtn =
  "group inline-flex items-center gap-2.5 rounded-xl bg-gradient-to-r from-[var(--color-accent-amber)] to-[#ff9933] px-8 py-4 text-[15px] font-bold text-[#0a0a0a] no-underline shadow-[0_0_24px_rgba(255,107,0,0.35)] transition-all duration-300 hover:shadow-[0_0_40px_rgba(255,107,0,0.55)] hover:scale-[1.03] active:scale-[0.98]";

const secondaryBtn =
  "group inline-flex items-center gap-2.5 rounded-xl border border-[oklch(0.25_0_0)] bg-[rgba(255,255,255,0.03)] px-7 py-4 text-[15px] font-semibold text-[oklch(0.8_0_0)] no-underline backdrop-blur-sm transition-all duration-300 hover:border-[var(--color-accent-amber)] hover:text-white hover:shadow-[0_0_20px_rgba(255,107,0,0.15)]";

const ghostBtn =
  "group inline-flex items-center gap-2 rounded-xl px-5 py-4 text-[15px] font-medium text-[oklch(0.5_0_0)] no-underline transition-all duration-300 hover:text-white hover:bg-[rgba(255,255,255,0.04)]";

function ArrowIcon() {
  return (
    <svg className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12h14" /><path d="m12 5 7 7-7 7" />
    </svg>
  );
}

function GitHubIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z" />
    </svg>
  );
}

export function LandingCTA() {
  const { data: session, isPending } = useSession();

  if (isPending) {
    return (
      <div className="flex flex-wrap justify-center gap-4">
        <div className="h-14 w-48 animate-pulse rounded-xl bg-[rgba(255,107,0,0.1)]" />
        <div className="h-14 w-40 animate-pulse rounded-xl bg-[var(--color-border)]" />
      </div>
    );
  }

  if (session?.user) {
    return (
      <div className="flex flex-wrap justify-center gap-4">
        <Link href="/runs" data-testid="cta-dashboard" className={primaryBtn}>
          Go to Dashboard
          <ArrowIcon />
        </Link>
        <a
          href="https://github.com/LoopStorm-Guard/loopstorm-guard"
          target="_blank"
          rel="noopener noreferrer"
          data-testid="cta-github"
          className={secondaryBtn}
        >
          <GitHubIcon />
          View on GitHub
        </a>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap justify-center gap-4">
      <Link href="/sign-up" data-testid="cta-get-started" className={primaryBtn}>
        Get Started Free
        <ArrowIcon />
      </Link>
      <a
        href="https://github.com/LoopStorm-Guard/loopstorm-guard"
        target="_blank"
        rel="noopener noreferrer"
        data-testid="cta-github"
        className={secondaryBtn}
      >
        <GitHubIcon />
        GitHub
      </a>
      <Link href="/sign-in" data-testid="cta-sign-in" className={ghostBtn}>
        Sign In
      </Link>
    </div>
  );
}
