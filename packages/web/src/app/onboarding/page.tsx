// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Onboarding page — shown to new users after sign-up.
 *
 * Walks the user through the three steps needed to start using LoopStorm Guard:
 * install the SDK, create an API key, and run their first agent.
 */

import Link from "next/link";

export const metadata = {
  title: "Get Started — LoopStorm Guard",
};

const steps = [
  {
    number: "01",
    title: "Install the SDK",
    description: "Add the LoopStorm Guard shim to your AI agent project.",
    code: "pip install loopstorm-guard\n# or: npm install @loopstorm/shim",
  },
  {
    number: "02",
    title: "Create an API Key",
    description: "Generate a key in the dashboard to authenticate your agent.",
    code: 'export LOOPSTORM_API_KEY="lsg_your_key_here"',
  },
  {
    number: "03",
    title: "Run Your First Agent",
    description: "Wrap your agent call — enforcement and audit logging start immediately.",
    code: "# Your agent now has policy enforcement,\n# loop detection, and a tamper-evident audit log.",
  },
];

export default function OnboardingPage() {
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "var(--color-bg)",
        padding: "2rem 1rem",
      }}
    >
      <div style={{ width: "100%", maxWidth: "40rem" }}>
        {/* Header */}
        <div style={{ textAlign: "center", marginBottom: "2.5rem" }}>
          <div style={{ marginBottom: "0.75rem" }}>
            <span
              style={{
                fontSize: "0.75rem",
                fontWeight: "600",
                color: "var(--color-accent-amber)",
                fontFamily: "var(--font-mono)",
                letterSpacing: "0.1em",
                textTransform: "uppercase",
              }}
            >
              Account created
            </span>
          </div>
          <h1
            style={{
              fontSize: "1.75rem",
              fontWeight: "700",
              color: "oklch(0.92 0.00 0)",
              margin: "0 0 0.5rem 0",
            }}
          >
            Welcome to LoopStorm Guard
          </h1>
          <p
            style={{
              fontSize: "0.9375rem",
              color: "oklch(0.60 0.00 0)",
              margin: 0,
              maxWidth: "28rem",
              marginInline: "auto",
            }}
          >
            Runtime enforcement and audit logging for AI agents. Follow these steps to
            protect your first agent.
          </p>
        </div>

        {/* Steps */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "1rem",
            marginBottom: "2rem",
          }}
        >
          {steps.map((step) => (
            <div
              key={step.number}
              style={{
                backgroundColor: "var(--color-surface)",
                border: "1px solid var(--color-border)",
                borderRadius: "0.5rem",
                padding: "1.25rem 1.5rem",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: "1rem",
                }}
              >
                <span
                  style={{
                    fontSize: "0.75rem",
                    fontWeight: "700",
                    color: "var(--color-accent-amber)",
                    fontFamily: "var(--font-mono)",
                    flexShrink: 0,
                    paddingTop: "0.125rem",
                  }}
                >
                  {step.number}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <h2
                    style={{
                      fontSize: "0.9375rem",
                      fontWeight: "600",
                      color: "oklch(0.88 0.00 0)",
                      margin: "0 0 0.25rem 0",
                    }}
                  >
                    {step.title}
                  </h2>
                  <p
                    style={{
                      fontSize: "0.8125rem",
                      color: "oklch(0.58 0.00 0)",
                      margin: "0 0 0.75rem 0",
                    }}
                  >
                    {step.description}
                  </p>
                  <pre
                    style={{
                      backgroundColor: "var(--color-bg)",
                      border: "1px solid var(--color-border)",
                      borderRadius: "0.375rem",
                      padding: "0.625rem 0.875rem",
                      fontSize: "0.75rem",
                      fontFamily: "var(--font-mono)",
                      color: "oklch(0.72 0.00 0)",
                      margin: 0,
                      overflowX: "auto",
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-all",
                    }}
                  >
                    {step.code}
                  </pre>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Actions */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "0.75rem",
            alignItems: "center",
          }}
        >
          <Link
            href="/sign-in"
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: "100%",
              maxWidth: "20rem",
              padding: "0.75rem 1.5rem",
              backgroundColor: "var(--color-accent-amber)",
              color: "#0a0a0a",
              borderRadius: "0.5rem",
              fontSize: "0.9375rem",
              fontWeight: "600",
              textDecoration: "none",
              textAlign: "center",
            }}
          >
            Sign in to Dashboard →
          </Link>
          <p
            style={{
              fontSize: "0.75rem",
              color: "oklch(0.45 0.00 0)",
              margin: 0,
            }}
          >
            You can also create your API key from the dashboard under{" "}
            <strong style={{ color: "oklch(0.60 0.00 0)" }}>Settings → API Keys</strong>.
          </p>
        </div>
      </div>
    </div>
  );
}
