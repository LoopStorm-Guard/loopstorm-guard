// SPDX-License-Identifier: AGPL-3.0-only
/**
 * LoopStorm Guard — public landing page.
 *
 * Server component. Public (no auth required).
 * Auth-aware CTA is delegated to the LandingCTA client component.
 *
 * IMPORTANT: This file is licensed AGPL-3.0-only (ADR-013).
 */

import { AnimatedTerminal } from "@/components/landing/animated-terminal";
import { FAQAccordion } from "@/components/landing/faq-accordion";
import { HeroPlayer } from "@/components/landing/hero-player";
import { LandingCTA } from "@/components/landing/landing-cta";
import { ScrollReveal } from "@/components/landing/scroll-reveal";
import { Suspense } from "react";

export const metadata = {
  title: "LoopStorm Guard — Runtime Guardrails for AI Agents",
  description:
    "Intercept every tool call. Enforce policies. Cap budgets. Detect loops. Write tamper-evident audit logs. All before your agent touches production.",
};

/* ── SVG Icon Components ─────────────────────────────────────────────────── */

type IconProps = { className?: string; style?: React.CSSProperties };

function IconShield({ className, style }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      style={style}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  );
}

function IconScan({ className, style }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      style={style}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 7V5a2 2 0 0 1 2-2h2" />
      <path d="M17 3h2a2 2 0 0 1 2 2v2" />
      <path d="M21 17v2a2 2 0 0 1-2 2h-2" />
      <path d="M7 21H5a2 2 0 0 1-2-2v-2" />
      <circle cx="12" cy="12" r="3" />
      <path d="M12 7v1" />
      <path d="M12 16v1" />
      <path d="M7 12h1" />
      <path d="M16 12h1" />
    </svg>
  );
}

function IconRefresh({ className, style }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      style={style}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M21 2v6h-6" />
      <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
      <path d="M3 22v-6h6" />
      <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
    </svg>
  );
}

function IconLock({ className, style }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      style={style}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3" y="11" width="18" height="11" rx="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}

function IconBrain({ className, style }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      style={style}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 2a5 5 0 0 1 4.3 7.5A5 5 0 0 1 18 14a5 5 0 0 1-3 4.58V22h-6v-3.42A5 5 0 0 1 6 14a5 5 0 0 1 1.7-4.5A5 5 0 0 1 12 2z" />
      <path d="M9 12h6" />
      <path d="M12 9v6" />
    </svg>
  );
}

function IconGitHub({ className }: IconProps) {
  return (
    <svg aria-hidden="true" className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z" />
    </svg>
  );
}

function IconFileCode({ className }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <path d="m10 13-2 2 2 2" />
      <path d="m14 17 2-2-2-2" />
    </svg>
  );
}

function IconTerminal({ className }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="4 17 10 11 4 5" />
      <line x1="12" x2="20" y1="19" y2="19" />
    </svg>
  );
}

function IconHash({ className }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <line x1="4" x2="20" y1="9" y2="9" />
      <line x1="4" x2="20" y1="15" y2="15" />
      <line x1="10" x2="8" y1="3" y2="21" />
      <line x1="16" x2="14" y1="3" y2="21" />
    </svg>
  );
}

function IconWifi({ className }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <line x1="2" x2="22" y1="2" y2="22" />
      <path d="M8.5 16.5a5 5 0 0 1 7 0" />
      <path d="M2 8.82a15 15 0 0 1 4.17-2.65" />
      <path d="M10.66 5c4.01-.36 8.14.9 11.34 3.76" />
      <path d="M16.85 11.25a10 10 0 0 1 2.22 1.68" />
      <path d="M5 12.86a10 10 0 0 1 5.17-2.89" />
      <line x1="12" x2="12.01" y1="20" y2="20" />
    </svg>
  );
}

function IconCode({ className }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="16 18 22 12 16 6" />
      <polyline points="8 6 2 12 8 18" />
    </svg>
  );
}

function IconZap({ className }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
    </svg>
  );
}

/* ── Announcement Banner ──────────────────────────────────────────────────── */

function AnnouncementBanner() {
  return (
    <div className="border-b border-[rgba(255,107,0,0.15)] bg-[rgba(255,107,0,0.04)]">
      <div className="mx-auto flex max-w-6xl items-center justify-center gap-3 px-6 py-2.5">
        <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-accent-green)] shadow-[0_0_6px_var(--color-accent-green)]" />
        <span className="text-[13px] text-[oklch(0.6_0_0)]">
          <span className="font-semibold text-white">v0.1.0 is live</span> &mdash; LoopStorm Guard
          is now open source.{" "}
          <a
            href="https://github.com/LoopStorm-Guard/loopstorm-guard"
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-[var(--color-accent-amber)] no-underline transition-colors hover:text-white"
          >
            Star us on GitHub &rarr;
          </a>
        </span>
      </div>
    </div>
  );
}

/* ── NavBar ───────────────────────────────────────────────────────────────── */

function NavBar() {
  return (
    <nav className="sticky top-0 z-50 border-b border-[rgba(255,255,255,0.06)] bg-[rgba(10,10,10,0.7)] backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
        <a href="/" className="flex items-center gap-1.5 no-underline">
          <span className="text-[15px] font-bold text-white">LoopStorm</span>
          <span className="font-[family-name:var(--font-mono)] text-sm font-semibold text-[var(--color-accent-amber)]">
            Guard
          </span>
        </a>

        <div className="hidden items-center gap-6 text-sm md:flex">
          <a
            href="#terminal"
            className="text-[oklch(0.5_0_0)] transition-colors duration-300 hover:text-white no-underline"
          >
            See It Work
          </a>
          <a
            href="#stages"
            className="text-[oklch(0.5_0_0)] transition-colors duration-300 hover:text-white no-underline"
          >
            How It Works
          </a>
          <a
            href="#features"
            className="text-[oklch(0.5_0_0)] transition-colors duration-300 hover:text-white no-underline"
          >
            Features
          </a>
          <a
            href="#code"
            className="text-[oklch(0.5_0_0)] transition-colors duration-300 hover:text-white no-underline"
          >
            Quick Start
          </a>
          <a
            href="#pricing"
            className="text-[oklch(0.5_0_0)] transition-colors duration-300 hover:text-white no-underline"
          >
            Pricing
          </a>
          <a
            href="#faq"
            className="text-[oklch(0.5_0_0)] transition-colors duration-300 hover:text-white no-underline"
          >
            FAQ
          </a>

          {/* GitHub with star count */}
          <a
            href="https://github.com/LoopStorm-Guard/loopstorm-guard"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 rounded-lg border border-[oklch(0.2_0_0)] bg-[rgba(255,255,255,0.03)] px-3.5 py-1.5 text-[13px] font-medium text-[oklch(0.6_0_0)] transition-all duration-300 hover:border-[var(--color-accent-amber)] hover:text-white hover:shadow-[0_0_16px_rgba(255,107,0,0.1)] no-underline"
          >
            <IconGitHub className="h-4 w-4" />
            <span>GitHub</span>
            <span className="rounded-md bg-[var(--color-bg)] px-1.5 py-0.5 font-[family-name:var(--font-mono)] text-[10px] text-[oklch(0.5_0_0)] ring-1 ring-[var(--color-border)]">
              MIT
            </span>
          </a>
        </div>
      </div>
    </nav>
  );
}

/* ── Hero ─────────────────────────────────────────────────────────────────── */

function HeroSection() {
  return (
    <section className="relative overflow-hidden">
      {/* Animated grid pattern */}
      <div className="hero-grid pointer-events-none absolute inset-0 opacity-40" />

      {/* Floating orbs */}
      <div className="pointer-events-none absolute inset-0">
        <div
          className="absolute left-1/4 top-1/4 h-[400px] w-[400px] rounded-full opacity-20 blur-[100px]"
          style={{
            background: "var(--color-accent-amber)",
            animation: "float-slow 12s ease-in-out infinite",
          }}
        />
        <div
          className="absolute right-1/4 top-1/3 h-[300px] w-[300px] rounded-full opacity-15 blur-[80px]"
          style={{
            background: "var(--color-accent-purple)",
            animation: "float-reverse 15s ease-in-out infinite",
          }}
        />
        <div
          className="absolute bottom-1/4 left-1/2 h-[250px] w-[250px] -translate-x-1/2 rounded-full opacity-10 blur-[80px]"
          style={{
            background: "var(--color-accent-red)",
            animation: "float-slow 18s ease-in-out infinite 3s",
          }}
        />
      </div>

      {/* Central radial glow */}
      <div className="pointer-events-none absolute inset-0 -top-20">
        <div className="absolute left-1/2 top-0 h-[600px] w-[900px] -translate-x-1/2 rounded-full bg-[radial-gradient(ellipse,rgba(255,107,0,0.12)_0%,transparent_70%)]" />
      </div>

      <div className="relative mx-auto max-w-6xl px-6 pb-16 pt-24 md:pb-24 md:pt-32">
        <div className="mx-auto max-w-3xl text-center">
          {/* Headline */}
          <h1 className="mb-6 text-5xl font-extrabold leading-[1.08] tracking-tight text-white md:text-7xl lg:text-8xl">
            Runtime Guardrails{" "}
            <span
              className="bg-gradient-to-r from-[var(--color-accent-amber)] via-[#ffaa44] to-[var(--color-accent-amber)] bg-[length:200%_auto] bg-clip-text text-transparent"
              style={{ animation: "gradient-x 4s ease infinite" }}
            >
              for AI Agents
            </span>
          </h1>

          {/* Subtitle */}
          <p className="mx-auto mb-12 max-w-2xl text-lg leading-relaxed text-[oklch(0.5_0_0)] md:text-xl">
            Intercept every tool call. Enforce policies. Cap budgets. Detect loops. Write
            tamper-evident audit logs.{" "}
            <span className="font-medium text-[oklch(0.75_0_0)]">
              All before your agent touches production.
            </span>
          </p>

          {/* CTA Buttons */}
          <Suspense
            fallback={
              <div className="flex justify-center gap-4">
                <div className="h-14 w-48 animate-pulse rounded-xl bg-[rgba(255,107,0,0.1)]" />
                <div className="h-14 w-40 animate-pulse rounded-xl bg-[var(--color-border)]" />
              </div>
            }
          >
            <LandingCTA />
          </Suspense>

          <p className="mt-6 font-[family-name:var(--font-mono)] text-xs text-[oklch(0.35_0_0)]">
            No credit card required &middot; 2-minute setup &middot; MIT licensed
          </p>
        </div>

        {/* Stats bar */}
        <div className="mx-auto mt-20 max-w-3xl">
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <StatCard value="< 1ms" label="P99 Latency" />
            <StatCard value="67+" label="Unit Tests" />
            <StatCard value="0" label="Network Deps" />
            <StatCard value="5" label="Control Stages" />
          </div>
        </div>
      </div>
    </section>
  );
}

function StatCard({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-xl border border-[var(--color-border)] bg-[rgba(17,17,17,0.6)] px-5 py-4 text-center backdrop-blur-sm">
      <div className="stat-glow font-[family-name:var(--font-mono)] text-2xl font-bold text-[var(--color-accent-amber)]">
        {value}
      </div>
      <div className="mt-1 text-xs text-[oklch(0.45_0_0)]">{label}</div>
    </div>
  );
}

/* ── Integration Logos ("Works With") ─────────────────────────────────────── */

const integrations = [
  "OpenAI",
  "Anthropic",
  "LangChain",
  "LlamaIndex",
  "CrewAI",
  "AutoGen",
  "Google Gemini",
  "Mistral",
];

function IntegrationLogosSection() {
  return (
    <section className="border-t border-[var(--color-border)] py-14">
      <div className="mx-auto max-w-6xl px-6">
        <p className="mb-8 text-center text-sm text-[oklch(0.4_0_0)]">
          Works with every AI framework that makes tool calls
        </p>
        <div className="flex flex-wrap items-center justify-center gap-x-10 gap-y-4">
          {integrations.map((name) => (
            <span
              key={name}
              className="font-[family-name:var(--font-mono)] text-sm font-medium text-[oklch(0.35_0_0)] transition-colors duration-300 hover:text-[oklch(0.6_0_0)]"
            >
              {name}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ── Pipeline Video ───────────────────────────────────────────────────────── */

function PipelineVideoSection() {
  return (
    <section className="border-t border-[var(--color-border)] py-16">
      <div className="mx-auto max-w-4xl px-6">
        <ScrollReveal>
          <Suspense
            fallback={
              <div className="aspect-video w-full animate-pulse rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)]" />
            }
          >
            <HeroPlayer />
          </Suspense>
        </ScrollReveal>
      </div>
    </section>
  );
}

/* ── Live Terminal ────────────────────────────────────────────────────────── */

function TerminalSection() {
  return (
    <section id="terminal" className="border-t border-[var(--color-border)] py-24">
      <div className="mx-auto max-w-6xl px-6">
        <ScrollReveal>
          <div className="mb-16 text-center">
            <p className="mb-3 font-[family-name:var(--font-mono)] text-xs font-medium uppercase tracking-widest text-[var(--color-accent-amber)]">
              See It Work
            </p>
            <h2 className="mb-4 text-3xl font-bold text-white md:text-4xl">
              Watch LoopStorm Intercept in Real Time
            </h2>
            <p className="mx-auto max-w-lg text-base leading-relaxed text-[oklch(0.5_0_0)]">
              Every tool call is evaluated against your policy. Allowed, denied, or killed &mdash;
              with a full audit trail.
            </p>
          </div>
        </ScrollReveal>

        <ScrollReveal delay={150}>
          <div className="mx-auto max-w-3xl">
            <AnimatedTerminal />
          </div>
        </ScrollReveal>
      </div>
    </section>
  );
}

/* ── Five Stages ──────────────────────────────────────────────────────────── */

const stages = [
  {
    num: 1,
    name: "Prevent",
    type: "Deterministic",
    icon: IconShield,
    color: "var(--color-accent-amber)",
    description: "Policy enforcement at the call boundary.",
    detail:
      "Binary allow or deny. First-match-wins rule evaluation. YAML-defined. P99 < 1ms latency.",
  },
  {
    num: 2,
    name: "Detect",
    type: "Deterministic",
    icon: IconScan,
    color: "var(--color-accent-amber)",
    description: "Loop-detection heuristics within a run.",
    detail:
      "Same call fingerprint? Error loops? Stuck retry cycles? Detected immediately — no ML required.",
  },
  {
    num: 3,
    name: "Recover",
    type: "Deterministic",
    icon: IconRefresh,
    color: "var(--color-accent-amber)",
    description: "Cooldown + corrective context injection.",
    detail:
      "One structured chance for the agent to self-correct. Bounded: if it fails, escalation is automatic.",
  },
  {
    num: 4,
    name: "Contain",
    type: "Deterministic",
    icon: IconLock,
    color: "var(--color-accent-amber)",
    description: "Safe termination with evidence preservation.",
    detail:
      "Clean shutdown, not a process kill. Audit log sealed. Evidence preserved for human review.",
  },
  {
    num: 5,
    name: "Adapt",
    type: "AI-Assisted",
    icon: IconBrain,
    color: "var(--color-supervisor)",
    description: "AI Supervisor on the observation plane.",
    detail:
      "Interprets patterns. Proposes policy updates. Escalates to humans. Never in the enforcement critical path.",
    isAdvisory: true,
  },
] as const;

function ControlStagesSection() {
  return (
    <section id="stages" className="border-t border-[var(--color-border)] py-24">
      <div className="mx-auto max-w-6xl px-6">
        <ScrollReveal>
          <div className="mb-16 text-center">
            <p className="mb-3 font-[family-name:var(--font-mono)] text-xs font-medium uppercase tracking-widest text-[var(--color-accent-amber)]">
              How It Works
            </p>
            <h2 className="mb-4 text-3xl font-bold text-white md:text-4xl">
              Five Stages of Control
            </h2>
            <p className="mx-auto max-w-lg text-base leading-relaxed text-[oklch(0.5_0_0)]">
              Stages 1 &ndash; 4 are fully deterministic. No AI in the critical path. Stage 5 is
              advisory only &mdash; human approval required.
            </p>
          </div>
        </ScrollReveal>

        <div className="relative">
          <div
            className="absolute left-8 top-0 hidden h-full w-px lg:block"
            style={{
              background:
                "linear-gradient(to bottom, var(--color-accent-amber), var(--color-border) 60%, var(--color-supervisor))",
            }}
          />
          <div className="grid gap-6 lg:gap-0">
            {stages.map((stage, i) => {
              const Icon = stage.icon;
              const isAI = "isAdvisory" in stage;
              return (
                <ScrollReveal key={stage.num} delay={i * 100}>
                  <div className="group relative lg:pl-20 lg:py-6">
                    <div
                      className="absolute left-6 top-8 z-10 hidden h-5 w-5 items-center justify-center rounded-full border-2 lg:flex"
                      style={{
                        borderColor: stage.color,
                        backgroundColor: "var(--color-bg)",
                        boxShadow: `0 0 12px ${stage.color}33`,
                      }}
                    >
                      <div
                        className="h-2 w-2 rounded-full"
                        style={{ backgroundColor: stage.color }}
                      />
                    </div>
                    <div
                      className={`card-glow rounded-xl border p-6 transition-all duration-300 md:p-8 ${isAI ? "border-[var(--color-supervisor-border)] bg-[var(--color-supervisor-bg)]" : "border-[var(--color-border)] bg-[rgba(17,17,17,0.5)] hover:bg-[rgba(17,17,17,0.8)]"}`}
                    >
                      <div className="flex flex-col gap-4 md:flex-row md:items-start md:gap-6">
                        <div
                          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border transition-all duration-300 group-hover:scale-110"
                          style={{
                            borderColor: isAI
                              ? "var(--color-supervisor-border)"
                              : "var(--color-border)",
                            backgroundColor: isAI ? "rgba(196,169,107,0.08)" : "var(--color-bg)",
                            boxShadow: `0 0 20px ${stage.color}11`,
                          }}
                        >
                          <Icon className="h-5 w-5" style={{ color: stage.color }} />
                        </div>
                        <div className="flex-1">
                          <div className="mb-2 flex flex-wrap items-center gap-3">
                            <span
                              className="font-[family-name:var(--font-mono)] text-[11px] font-semibold uppercase tracking-wider"
                              style={{ color: stage.color }}
                            >
                              Stage {stage.num}
                            </span>
                            <span className="rounded-full bg-[var(--color-bg)] px-2.5 py-0.5 font-[family-name:var(--font-mono)] text-[10px] text-[oklch(0.45_0_0)] ring-1 ring-[var(--color-border)]">
                              {stage.type}
                            </span>
                          </div>
                          <h3
                            className={`mb-1.5 text-lg font-bold ${isAI ? "italic" : ""}`}
                            style={{ color: isAI ? "var(--color-supervisor)" : "oklch(0.92 0 0)" }}
                          >
                            {stage.name}
                          </h3>
                          <p
                            className="mb-2 text-sm"
                            style={{ color: isAI ? "var(--color-supervisor)" : "oklch(0.65 0 0)" }}
                          >
                            {stage.description}
                          </p>
                          <p className="text-sm leading-relaxed text-[oklch(0.45_0_0)]">
                            {stage.detail}
                          </p>
                          {isAI && (
                            <p className="mt-3 font-[family-name:var(--font-mono)] text-xs italic text-[var(--color-supervisor)]">
                              Advisory only &middot; Human approval required &middot; Self-guarded
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </ScrollReveal>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}

/* ── Features Grid ────────────────────────────────────────────────────────── */

const features = [
  {
    icon: IconFileCode,
    title: "Policy Rules",
    description:
      "YAML-defined rules. Deny cloud metadata, block unauthorized tools, restrict URLs. First match wins.",
  },
  {
    icon: IconTerminal,
    title: "Budget Caps",
    description:
      "Hard limits on cost (USD), tokens, and call count per run. Fail-closed when exceeded.",
  },
  {
    icon: IconScan,
    title: "Loop Detection",
    description:
      "Fingerprint-based heuristics catch retry loops, error loops, and stuck agents automatically.",
  },
  {
    icon: IconHash,
    title: "Hash-Chain Audit Log",
    description:
      "Tamper-evident JSONL log with SHA-256 hash chain. CLI-verifiable. Any tampering is detectable.",
  },
  {
    icon: IconWifi,
    title: "Mode 0 — Air-Gapped",
    description: "Runs entirely local. No account. No network. No telemetry. pip install and go.",
  },
  {
    icon: IconCode,
    title: "Open Core",
    description: "Engine + CLI + shims are MIT. Use them anywhere. Control plane UI is AGPL-3.0.",
  },
];

function FeaturesSection() {
  return (
    <section id="features" className="border-t border-[var(--color-border)] py-24">
      <div className="mx-auto max-w-6xl px-6">
        <ScrollReveal>
          <div className="mb-16 text-center">
            <p className="mb-3 font-[family-name:var(--font-mono)] text-xs font-medium uppercase tracking-widest text-[var(--color-accent-amber)]">
              Capabilities
            </p>
            <h2 className="mb-4 text-3xl font-bold text-white md:text-4xl">Everything You Need</h2>
            <p className="mx-auto max-w-lg text-base leading-relaxed text-[oklch(0.5_0_0)]">
              A complete safety layer between your AI agents and production systems.
            </p>
          </div>
        </ScrollReveal>

        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((feature, i) => {
            const Icon = feature.icon;
            return (
              <ScrollReveal key={feature.title} delay={i * 80}>
                <div className="card-glow group h-full rounded-xl border border-[var(--color-border)] bg-[rgba(17,17,17,0.5)] p-6 transition-all duration-300 hover:bg-[rgba(17,17,17,0.8)]">
                  <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] transition-all duration-300 group-hover:border-[rgba(255,107,0,0.3)] group-hover:shadow-[0_0_16px_rgba(255,107,0,0.1)]">
                    <Icon className="h-5 w-5 text-[oklch(0.5_0_0)] transition-colors duration-300 group-hover:text-[var(--color-accent-amber)]" />
                  </div>
                  <h3 className="mb-2 text-[15px] font-semibold text-[oklch(0.9_0_0)]">
                    {feature.title}
                  </h3>
                  <p className="text-sm leading-relaxed text-[oklch(0.5_0_0)]">
                    {feature.description}
                  </p>
                </div>
              </ScrollReveal>
            );
          })}
        </div>
      </div>
    </section>
  );
}

/* ── Code Examples ────────────────────────────────────────────────────────── */

function CodeSection() {
  const pythonCode = `from loopstorm import guard

@guard(policy="loopstorm.yaml")
def my_agent():
    # Every tool call is now intercepted,
    # policy-checked, budget-tracked, and logged
    result = call_tool("web_search", {"query": "..."})
    return result`;

  const tsCode = `import { guard } from "loopstorm-ts";

const run = guard({ policy: "loopstorm.yaml" });

// Wrap your agent's tool calls
const result = await run.wrap("web_search", {
  query: "..."
});`;

  const yamlCode = `# loopstorm.yaml
agent_role: my-agent
rules:
  - name: deny-cloud-metadata
    action: deny
    tool_pattern: "http.*"
    conditions:
      - field: url
        operator: matches
        pattern: "169.254.169.254.*"
budget:
  cost_usd:
    hard: 5.00
  calls:
    hard: 100`;

  return (
    <section id="code" className="border-t border-[var(--color-border)] py-24">
      <div className="mx-auto max-w-6xl px-6">
        <ScrollReveal>
          <div className="mb-16 text-center">
            <p className="mb-3 font-[family-name:var(--font-mono)] text-xs font-medium uppercase tracking-widest text-[var(--color-accent-amber)]">
              Quick Start
            </p>
            <h2 className="mb-4 text-3xl font-bold text-white md:text-4xl">
              Integrate in Under 2 Minutes
            </h2>
            <p className="mx-auto max-w-lg text-base leading-relaxed text-[oklch(0.5_0_0)]">
              Add LoopStorm Guard to your agent in Python or TypeScript. Define your policy in YAML.
            </p>
          </div>
        </ScrollReveal>

        <div className="grid gap-5 lg:grid-cols-3">
          <ScrollReveal delay={0}>
            <CodeBlock filename="agent.py" lang="Python" code={pythonCode} />
          </ScrollReveal>
          <ScrollReveal delay={100}>
            <CodeBlock filename="agent.ts" lang="TypeScript" code={tsCode} />
          </ScrollReveal>
          <ScrollReveal delay={200}>
            <CodeBlock filename="loopstorm.yaml" lang="Policy" code={yamlCode} />
          </ScrollReveal>
        </div>
      </div>
    </section>
  );
}

function CodeBlock({ filename, lang, code }: { filename: string; lang: string; code: string }) {
  return (
    <div className="card-glow h-full overflow-hidden rounded-xl border border-[var(--color-border)] bg-[#080808]">
      <div className="flex items-center justify-between border-b border-[var(--color-border)] px-4 py-3">
        <span className="font-[family-name:var(--font-mono)] text-[11px] text-[oklch(0.45_0_0)]">
          {filename}
        </span>
        <span className="rounded-full bg-[var(--color-bg)] px-2.5 py-0.5 font-[family-name:var(--font-mono)] text-[10px] text-[oklch(0.4_0_0)] ring-1 ring-[var(--color-border)]">
          {lang}
        </span>
      </div>
      <pre className="overflow-x-auto p-5">
        <code className="font-[family-name:var(--font-mono)] text-[13px] leading-relaxed text-[oklch(0.65_0_0)]">
          {code}
        </code>
      </pre>
    </div>
  );
}

/* ── Pricing / OSS + Cloud ────────────────────────────────────────────────── */

function PricingSection() {
  return (
    <section id="pricing" className="border-t border-[var(--color-border)] py-24">
      <div className="mx-auto max-w-6xl px-6">
        <ScrollReveal>
          <div className="mb-16 text-center">
            <p className="mb-3 font-[family-name:var(--font-mono)] text-xs font-medium uppercase tracking-widest text-[var(--color-accent-amber)]">
              Pricing
            </p>
            <h2 className="mb-4 text-3xl font-bold text-white md:text-4xl">
              Free to Start. Built to Scale.
            </h2>
            <p className="mx-auto max-w-lg text-base leading-relaxed text-[oklch(0.5_0_0)]">
              The open-source engine is free forever. The cloud dashboard gives your team
              visibility.
            </p>
          </div>
        </ScrollReveal>

        <div className="mx-auto grid max-w-4xl gap-6 lg:grid-cols-3">
          {/* Free tier */}
          <ScrollReveal delay={0}>
            <div className="card-glow flex h-full flex-col rounded-2xl border border-[var(--color-border)] bg-[rgba(17,17,17,0.5)] p-8">
              <div className="mb-6">
                <span className="rounded-lg bg-[rgba(0,200,83,0.1)] px-3 py-1 font-[family-name:var(--font-mono)] text-xs font-bold text-[var(--color-accent-green)]">
                  MIT
                </span>
              </div>
              <h3 className="mb-1 text-xl font-bold text-white">Open Source</h3>
              <div className="mb-4">
                <span className="text-3xl font-extrabold text-white">$0</span>
                <span className="text-sm text-[oklch(0.5_0_0)]"> / forever</span>
              </div>
              <p className="mb-6 text-sm leading-relaxed text-[oklch(0.5_0_0)]">
                Full enforcement engine. No limits. No account. No network dependency.
              </p>
              <ul className="mb-8 flex flex-col gap-3">
                {[
                  "Rust enforcement engine",
                  "Python + TypeScript shims",
                  "CLI (validate, verify, replay)",
                  "Policy rules + budget caps",
                  "Loop detection",
                  "Hash-chain audit logs",
                  "Air-gapped (Mode 0)",
                ].map((item) => (
                  <li key={item} className="flex items-start gap-2.5 text-sm text-[oklch(0.6_0_0)]">
                    <span className="mt-1 text-[var(--color-accent-green)]">&#10003;</span>
                    {item}
                  </li>
                ))}
              </ul>
              <a
                href="https://github.com/LoopStorm-Guard/loopstorm-guard"
                target="_blank"
                rel="noopener noreferrer"
                className="mt-auto inline-flex items-center justify-center gap-2 rounded-xl border border-[var(--color-border)] bg-transparent px-6 py-3 text-[15px] font-semibold text-[oklch(0.8_0_0)] no-underline transition-all duration-300 hover:border-[var(--color-accent-amber)] hover:text-white"
              >
                <IconGitHub className="h-4 w-4" />
                Get Started
              </a>
            </div>
          </ScrollReveal>

          {/* Pro tier */}
          <ScrollReveal delay={100}>
            <div className="relative flex h-full flex-col rounded-2xl border-2 border-[var(--color-accent-amber)] bg-[rgba(255,107,0,0.03)] p-8 shadow-[0_0_40px_rgba(255,107,0,0.08)]">
              <div className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-[var(--color-accent-amber)] px-4 py-1 font-[family-name:var(--font-mono)] text-[11px] font-bold text-[#0a0a0a]">
                RECOMMENDED
              </div>
              <div className="mb-6">
                <span className="rounded-lg bg-[rgba(255,107,0,0.1)] px-3 py-1 font-[family-name:var(--font-mono)] text-xs font-bold text-[var(--color-accent-amber)]">
                  CLOUD
                </span>
              </div>
              <h3 className="mb-1 text-xl font-bold text-white">Pro</h3>
              <div className="mb-4">
                <span className="text-3xl font-extrabold text-white">$49</span>
                <span className="text-sm text-[oklch(0.5_0_0)]"> / month</span>
              </div>
              <p className="mb-6 text-sm leading-relaxed text-[oklch(0.5_0_0)]">
                Everything in Open Source, plus a hosted dashboard for team visibility.
              </p>
              <ul className="mb-8 flex flex-col gap-3">
                {[
                  "Everything in Open Source",
                  "Web dashboard",
                  "Team management (5 seats)",
                  "Cross-run analytics",
                  "Event ingest API",
                  "7-day log retention",
                  "Email support",
                ].map((item) => (
                  <li key={item} className="flex items-start gap-2.5 text-sm text-[oklch(0.6_0_0)]">
                    <span className="mt-1 text-[var(--color-accent-amber)]">&#10003;</span>
                    {item}
                  </li>
                ))}
              </ul>
              <a
                href="/sign-up"
                className="mt-auto inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[var(--color-accent-amber)] to-[#ff9933] px-6 py-3 text-[15px] font-bold text-[#0a0a0a] no-underline shadow-[0_0_20px_rgba(255,107,0,0.3)] transition-all duration-300 hover:shadow-[0_0_30px_rgba(255,107,0,0.5)] hover:scale-[1.02]"
              >
                Start Free Trial
              </a>
              <p className="mt-3 text-center font-[family-name:var(--font-mono)] text-[11px] text-[oklch(0.4_0_0)]">
                7-day free trial &middot; No credit card required
              </p>
            </div>
          </ScrollReveal>

          {/* Enterprise tier */}
          <ScrollReveal delay={200}>
            <div className="card-glow flex h-full flex-col rounded-2xl border border-[var(--color-border)] bg-[rgba(17,17,17,0.5)] p-8">
              <div className="mb-6">
                <span className="rounded-lg bg-[rgba(155,109,255,0.1)] px-3 py-1 font-[family-name:var(--font-mono)] text-xs font-bold text-[var(--color-accent-purple)]">
                  ENTERPRISE
                </span>
              </div>
              <h3 className="mb-1 text-xl font-bold text-white">Enterprise</h3>
              <div className="mb-4">
                <span className="text-3xl font-extrabold text-white">Custom</span>
              </div>
              <p className="mb-6 text-sm leading-relaxed text-[oklch(0.5_0_0)]">
                Self-hosted or managed. Full data sovereignty. AI Supervisor on the observation
                plane.
              </p>
              <ul className="mb-8 flex flex-col gap-3">
                {[
                  "Everything in Pro",
                  "Unlimited seats",
                  "Self-hosted option (Helm/Docker)",
                  "SSO / SAML",
                  "90-day log retention",
                  "AI Supervisor (advisory)",
                  "SLA + priority support",
                ].map((item) => (
                  <li key={item} className="flex items-start gap-2.5 text-sm text-[oklch(0.6_0_0)]">
                    <span className="mt-1 text-[var(--color-accent-purple)]">&#10003;</span>
                    {item}
                  </li>
                ))}
              </ul>
              <a
                href="mailto:contact@loopstorm.dev"
                className="mt-auto inline-flex items-center justify-center gap-2 rounded-xl border border-[var(--color-border)] bg-transparent px-6 py-3 text-[15px] font-semibold text-[oklch(0.8_0_0)] no-underline transition-all duration-300 hover:border-[var(--color-accent-purple)] hover:text-white"
              >
                Contact Sales
              </a>
            </div>
          </ScrollReveal>
        </div>
      </div>
    </section>
  );
}

/* ── Open Source Section ──────────────────────────────────────────────────── */

function OpenSourceSection() {
  return (
    <section className="border-t border-[var(--color-border)] py-24">
      <div className="mx-auto max-w-6xl px-6">
        <ScrollReveal>
          <div className="mb-16 text-center">
            <p className="mb-3 font-[family-name:var(--font-mono)] text-xs font-medium uppercase tracking-widest text-[var(--color-accent-amber)]">
              Open Source
            </p>
            <h2 className="mb-4 text-3xl font-bold text-white md:text-4xl">Proudly Open Source</h2>
            <p className="mx-auto max-w-lg text-base leading-relaxed text-[oklch(0.5_0_0)]">
              We believe the best safety tools are built in the open. Inspect every line. Deploy
              anywhere. Contribute back.
            </p>
          </div>
        </ScrollReveal>

        <div className="mx-auto grid max-w-4xl gap-5 md:grid-cols-3">
          <ScrollReveal delay={0}>
            <div className="card-glow h-full rounded-xl border border-[var(--color-border)] bg-[rgba(17,17,17,0.5)] p-6">
              <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)]">
                <IconGitHub className="h-5 w-5 text-[oklch(0.6_0_0)]" />
              </div>
              <h3 className="mb-2 text-[15px] font-semibold text-[oklch(0.9_0_0)]">Contribute</h3>
              <p className="text-sm leading-relaxed text-[oklch(0.5_0_0)]">
                Engine (Rust), shims (Python/TS), and CLI are MIT licensed. PRs welcome.
              </p>
            </div>
          </ScrollReveal>
          <ScrollReveal delay={80}>
            <div className="card-glow h-full rounded-xl border border-[var(--color-border)] bg-[rgba(17,17,17,0.5)] p-6">
              <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)]">
                <IconShield className="h-5 w-5 text-[oklch(0.6_0_0)]" />
              </div>
              <h3 className="mb-2 text-[15px] font-semibold text-[oklch(0.9_0_0)]">Self-Host</h3>
              <p className="text-sm leading-relaxed text-[oklch(0.5_0_0)]">
                Deploy the full control plane on your infrastructure. Docker, Kubernetes, or bare
                metal.
              </p>
            </div>
          </ScrollReveal>
          <ScrollReveal delay={160}>
            <div className="card-glow h-full rounded-xl border border-[var(--color-border)] bg-[rgba(17,17,17,0.5)] p-6">
              <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)]">
                <IconHash className="h-5 w-5 text-[oklch(0.6_0_0)]" />
              </div>
              <h3 className="mb-2 text-[15px] font-semibold text-[oklch(0.9_0_0)]">
                Verify Everything
              </h3>
              <p className="text-sm leading-relaxed text-[oklch(0.5_0_0)]">
                Schema hashes in VERIFY.md. Audit logs are CLI-verifiable. Reproducible builds.
              </p>
            </div>
          </ScrollReveal>
        </div>

        <ScrollReveal delay={200}>
          <div className="mt-10 text-center">
            <a
              href="https://github.com/LoopStorm-Guard/loopstorm-guard"
              target="_blank"
              rel="noopener noreferrer"
              className="group inline-flex items-center gap-2.5 rounded-xl border border-[oklch(0.25_0_0)] bg-[rgba(255,255,255,0.03)] px-6 py-3 text-[15px] font-semibold text-[oklch(0.8_0_0)] no-underline transition-all duration-300 hover:border-[var(--color-accent-amber)] hover:text-white"
            >
              <IconGitHub className="h-5 w-5" />
              Star us on GitHub
            </a>
          </div>
        </ScrollReveal>
      </div>
    </section>
  );
}

/* ── FAQ ──────────────────────────────────────────────────────────────────── */

function FAQSection() {
  return (
    <section id="faq" className="border-t border-[var(--color-border)] py-24">
      <div className="mx-auto max-w-6xl px-6">
        <ScrollReveal>
          <div className="mb-16 text-center">
            <p className="mb-3 font-[family-name:var(--font-mono)] text-xs font-medium uppercase tracking-widest text-[var(--color-accent-amber)]">
              FAQ
            </p>
            <h2 className="mb-4 text-3xl font-bold text-white md:text-4xl">
              Frequently Asked Questions
            </h2>
          </div>
        </ScrollReveal>

        <ScrollReveal delay={100}>
          <FAQAccordion />
        </ScrollReveal>
      </div>
    </section>
  );
}

/* ── CTA Banner ──────────────────────────────────────────────────────────── */

function CTABanner() {
  return (
    <section className="border-t border-[var(--color-border)] py-24">
      <div className="mx-auto max-w-6xl px-6">
        <ScrollReveal>
          <div className="relative overflow-hidden rounded-2xl border border-[rgba(255,107,0,0.15)] bg-[rgba(255,107,0,0.03)] px-8 py-16 text-center md:px-16">
            <div className="pointer-events-none absolute inset-0">
              <div className="absolute left-1/2 top-1/2 h-[300px] w-[500px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(ellipse,rgba(255,107,0,0.08)_0%,transparent_70%)]" />
            </div>
            <div className="relative">
              <IconZap className="mx-auto mb-6 h-10 w-10 text-[var(--color-accent-amber)]" />
              <h2 className="mb-4 text-3xl font-bold text-white md:text-4xl">
                Stop Your Agents Before They Stop You
              </h2>
              <p className="mx-auto mb-8 max-w-xl text-base leading-relaxed text-[oklch(0.5_0_0)]">
                LoopStorm Guard is open source, free, and installs in under a minute. No account
                required. No network dependency. Just safety.
              </p>
              <div className="flex flex-wrap justify-center gap-4">
                <a
                  href="https://github.com/LoopStorm-Guard/loopstorm-guard"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group inline-flex items-center gap-2.5 rounded-xl bg-gradient-to-r from-[var(--color-accent-amber)] to-[#ff9933] px-8 py-4 text-[15px] font-bold text-[#0a0a0a] no-underline shadow-[0_0_24px_rgba(255,107,0,0.35)] transition-all duration-300 hover:shadow-[0_0_40px_rgba(255,107,0,0.55)] hover:scale-[1.03]"
                >
                  <IconGitHub className="h-5 w-5" />
                  View on GitHub
                </a>
              </div>
              <p className="mt-6 font-[family-name:var(--font-mono)] text-xs text-[oklch(0.35_0_0)]">
                pip install loopstorm-py &middot; MIT licensed
              </p>
            </div>
          </div>
        </ScrollReveal>
      </div>
    </section>
  );
}

/* ── Footer ───────────────────────────────────────────────────────────────── */

function SiteFooter() {
  return (
    <footer className="border-t border-[var(--color-border)] py-16">
      <div className="mx-auto max-w-6xl px-6">
        {/* Footer grid */}
        <div className="mb-12 grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
          {/* Brand */}
          <div>
            <div className="mb-4 flex items-center gap-1.5">
              <span className="text-sm font-bold text-white">LoopStorm</span>
              <span className="font-[family-name:var(--font-mono)] text-xs font-semibold text-[var(--color-accent-amber)]">
                Guard
              </span>
            </div>
            <p className="text-sm leading-relaxed text-[oklch(0.4_0_0)]">
              Runtime guardrails for AI agents. Open source. Fail-closed. No AI in the critical
              path.
            </p>
          </div>

          {/* Product */}
          <div>
            <h4 className="mb-4 font-[family-name:var(--font-mono)] text-xs font-semibold uppercase tracking-wider text-[oklch(0.5_0_0)]">
              Product
            </h4>
            <ul className="flex flex-col gap-2.5">
              {[
                { label: "Features", href: "#features" },
                { label: "Pricing", href: "#pricing" },
                { label: "Quick Start", href: "#code" },
                { label: "FAQ", href: "#faq" },
              ].map((link) => (
                <li key={link.label}>
                  <a
                    href={link.href}
                    className="text-sm text-[oklch(0.4_0_0)] no-underline transition-colors duration-300 hover:text-white"
                  >
                    {link.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>

          {/* Resources */}
          <div>
            <h4 className="mb-4 font-[family-name:var(--font-mono)] text-xs font-semibold uppercase tracking-wider text-[oklch(0.5_0_0)]">
              Resources
            </h4>
            <ul className="flex flex-col gap-2.5">
              {[
                {
                  label: "Documentation",
                  href: "https://github.com/LoopStorm-Guard/loopstorm-guard/tree/main/docs",
                },
                { label: "GitHub", href: "https://github.com/LoopStorm-Guard/loopstorm-guard" },
                {
                  label: "Security",
                  href: "https://github.com/LoopStorm-Guard/loopstorm-guard/blob/main/SECURITY.md",
                },
                {
                  label: "Changelog",
                  href: "https://github.com/LoopStorm-Guard/loopstorm-guard/releases",
                },
              ].map((link) => (
                <li key={link.label}>
                  <a
                    href={link.href}
                    target={link.href.startsWith("http") ? "_blank" : undefined}
                    rel={link.href.startsWith("http") ? "noopener noreferrer" : undefined}
                    className="text-sm text-[oklch(0.4_0_0)] no-underline transition-colors duration-300 hover:text-white"
                  >
                    {link.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>

          {/* Company */}
          <div>
            <h4 className="mb-4 font-[family-name:var(--font-mono)] text-xs font-semibold uppercase tracking-wider text-[oklch(0.5_0_0)]">
              Company
            </h4>
            <ul className="flex flex-col gap-2.5">
              {[
                { label: "Sign In", href: "/sign-in" },
                { label: "Contact", href: "mailto:contact@loopstorm.dev" },
              ].map((link) => (
                <li key={link.label}>
                  <a
                    href={link.href}
                    className="text-sm text-[oklch(0.4_0_0)] no-underline transition-colors duration-300 hover:text-white"
                  >
                    {link.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Bottom bar */}
        <div className="flex flex-col items-center justify-between gap-4 border-t border-[var(--color-border)] pt-8 md:flex-row">
          <p className="text-xs text-[oklch(0.3_0_0)]">
            &copy; 2026 GMW Solutions LLC. All rights reserved.
          </p>
          <div className="flex items-center gap-4">
            <span className="rounded-md bg-[rgba(0,200,83,0.1)] px-2 py-0.5 font-[family-name:var(--font-mono)] text-[10px] font-semibold text-[var(--color-accent-green)]">
              MIT
            </span>
            <span className="text-[10px] text-[oklch(0.3_0_0)]">Engine + CLI + Shims</span>
            <span className="rounded-md bg-[rgba(155,109,255,0.1)] px-2 py-0.5 font-[family-name:var(--font-mono)] text-[10px] font-semibold text-[var(--color-accent-purple)]">
              AGPL-3.0
            </span>
            <span className="text-[10px] text-[oklch(0.3_0_0)]">Backend + Web</span>
          </div>
        </div>
      </div>
    </footer>
  );
}

/* ── Page ─────────────────────────────────────────────────────────────────── */

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-[var(--color-bg)]">
      <AnnouncementBanner />
      <NavBar />
      <HeroSection />
      <IntegrationLogosSection />
      <PipelineVideoSection />
      <TerminalSection />
      <ControlStagesSection />
      <FeaturesSection />
      <CodeSection />
      <PricingSection />
      <OpenSourceSection />
      <FAQSection />
      <CTABanner />
      <SiteFooter />
    </div>
  );
}
