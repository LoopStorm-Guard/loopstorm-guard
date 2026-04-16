"use client";
// SPDX-License-Identifier: AGPL-3.0-only

import Link from "next/link";
import { useEffect, useState } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Props {
  userName: string;
  hasApiKeys: boolean;
  hasRuns: boolean;
}

type Lang = "python" | "typescript";

// ─── Code snippets ────────────────────────────────────────────────────────────

const INSTALL: Record<Lang, string> = {
  python: "pip install loopstorm-guard",
  typescript: "npm install @loopstorm/shim\n# or: bun add @loopstorm/shim",
};

const CONFIGURE: Record<Lang, string> = {
  python: `import os
os.environ["LOOPSTORM_API_KEY"] = "lsg_your_key_here"
os.environ["LOOPSTORM_API_URL"] = "https://api.loop-storm.com"`,
  typescript: `# .env
LOOPSTORM_API_KEY=lsg_your_key_here
LOOPSTORM_API_URL=https://api.loop-storm.com`,
};

const INTEGRATE: Record<Lang, string> = {
  python: `from loopstorm_guard import Guard

guard = Guard()

@guard.run(agent_name="my-agent", policy_pack="default")
def run_agent():
    # Your existing agent code here — nothing else changes.
    result = my_llm_call(prompt)
    return result`,
  typescript: `import { Guard } from "@loopstorm/shim";

const guard = new Guard({
  agentName: "my-agent",
  policyPack: "default",
});

const result = await guard.run(async () => {
  // Your existing agent code here — nothing else changes.
  return await myLLMCall(prompt);
});`,
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

const LS_KEY = "loopstorm_onboarding_manual";

function loadManual(): Record<string, boolean> {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(localStorage.getItem(LS_KEY) ?? "{}");
  } catch {
    return {};
  }
}

function saveManual(state: Record<string, boolean>) {
  localStorage.setItem(LS_KEY, JSON.stringify(state));
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      style={{
        padding: "0.25rem 0.625rem",
        fontSize: "0.6875rem",
        fontFamily: "var(--font-mono)",
        fontWeight: "500",
        color: copied ? "var(--color-accent-green, #00c853)" : "oklch(0.55 0.00 0)",
        backgroundColor: "transparent",
        border: "1px solid var(--color-border)",
        borderRadius: "0.25rem",
        cursor: "pointer",
        transition: "color 0.15s, border-color 0.15s",
        flexShrink: 0,
      }}
    >
      {copied ? "✓ Copied" : "Copy"}
    </button>
  );
}

function CodeBlock({ code, lang }: { code: string; lang: Lang }) {
  return (
    <div style={{ position: "relative" }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "0.375rem 0.75rem",
          backgroundColor: "oklch(0.10 0.00 0)",
          borderBottom: "1px solid var(--color-border)",
          borderRadius: "0.375rem 0.375rem 0 0",
        }}
      >
        <span
          style={{
            fontSize: "0.6875rem",
            color: "oklch(0.45 0.00 0)",
            fontFamily: "var(--font-mono)",
          }}
        >
          {lang === "python" ? "python" : "bash / .env"}
        </span>
        <CopyButton text={code} />
      </div>
      <pre
        style={{
          margin: 0,
          padding: "0.875rem 1rem",
          backgroundColor: "oklch(0.08 0.00 0)",
          borderRadius: "0 0 0.375rem 0.375rem",
          fontSize: "0.8125rem",
          fontFamily: "var(--font-mono)",
          color: "oklch(0.78 0.00 0)",
          overflowX: "auto",
          whiteSpace: "pre",
          lineHeight: 1.6,
        }}
      >
        {code}
      </pre>
    </div>
  );
}

function LangTab({
  lang,
  active,
  onClick,
}: { lang: Lang; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: "0.375rem 0.875rem",
        fontSize: "0.8125rem",
        fontWeight: active ? "600" : "400",
        color: active ? "var(--color-accent-amber)" : "oklch(0.55 0.00 0)",
        backgroundColor: active ? "rgba(255,107,0,0.08)" : "transparent",
        border: "none",
        borderBottom: active ? "2px solid var(--color-accent-amber)" : "2px solid transparent",
        cursor: "pointer",
        transition: "color 0.15s",
      }}
    >
      {lang === "python" ? "🐍 Python" : "📦 TypeScript"}
    </button>
  );
}

function StepCard({
  number,
  title,
  description,
  done,
  manual,
  onToggle,
  children,
}: {
  number: number;
  title: string;
  description: string;
  done: boolean;
  manual: boolean;
  onToggle?: () => void;
  children?: React.ReactNode;
}) {
  return (
    <div
      style={{
        backgroundColor: "var(--color-surface)",
        border: `1px solid ${done ? "oklch(0.35 0.08 145)" : "var(--color-border)"}`,
        borderRadius: "0.625rem",
        overflow: "hidden",
        transition: "border-color 0.2s",
      }}
    >
      {/* Step header */}
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: "1rem",
          padding: "1.25rem 1.5rem",
        }}
      >
        {/* Number / checkmark */}
        <div
          onClick={manual && onToggle ? onToggle : undefined}
          style={{
            width: "2rem",
            height: "2rem",
            borderRadius: "50%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
            backgroundColor: done ? "oklch(0.28 0.08 145)" : "oklch(0.12 0.00 0)",
            border: `2px solid ${done ? "oklch(0.50 0.12 145)" : "var(--color-border)"}`,
            cursor: manual && onToggle ? "pointer" : "default",
            transition: "background-color 0.2s, border-color 0.2s",
          }}
        >
          {done ? (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="oklch(0.70 0.15 145)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          ) : (
            <span
              style={{
                fontSize: "0.6875rem",
                fontWeight: "700",
                color: "oklch(0.50 0.00 0)",
                fontFamily: "var(--font-mono)",
              }}
            >
              {String(number).padStart(2, "0")}
            </span>
          )}
        </div>

        {/* Title + description */}
        <div style={{ flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
            <h2
              style={{
                fontSize: "0.9375rem",
                fontWeight: "600",
                color: done ? "oklch(0.70 0.08 145)" : "oklch(0.88 0.00 0)",
                margin: 0,
              }}
            >
              {title}
            </h2>
            {done && (
              <span
                style={{
                  fontSize: "0.6875rem",
                  fontWeight: "600",
                  color: "oklch(0.55 0.10 145)",
                  backgroundColor: "oklch(0.18 0.06 145)",
                  border: "1px solid oklch(0.30 0.08 145)",
                  borderRadius: "999px",
                  padding: "0.125rem 0.5rem",
                }}
              >
                Done
              </span>
            )}
            {manual && !done && onToggle && (
              <button
                type="button"
                onClick={onToggle}
                style={{
                  fontSize: "0.6875rem",
                  color: "oklch(0.50 0.00 0)",
                  backgroundColor: "transparent",
                  border: "1px solid var(--color-border)",
                  borderRadius: "999px",
                  padding: "0.125rem 0.5rem",
                  cursor: "pointer",
                }}
              >
                Mark done
              </button>
            )}
          </div>
          <p
            style={{
              fontSize: "0.8125rem",
              color: "oklch(0.56 0.00 0)",
              margin: "0.25rem 0 0 0",
            }}
          >
            {description}
          </p>
        </div>
      </div>

      {/* Step body */}
      {children && (
        <div
          style={{
            borderTop: "1px solid var(--color-border)",
            padding: "1rem 1.5rem 1.25rem",
          }}
        >
          {children}
        </div>
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function OnboardingClient({ userName, hasApiKeys, hasRuns }: Props) {
  const [lang, setLang] = useState<Lang>("python");
  const [manual, setManual] = useState<Record<string, boolean>>({});

  useEffect(() => {
    setManual(loadManual());
  }, []);

  function toggleManual(key: string) {
    const next = { ...manual, [key]: !manual[key] };
    setManual(next);
    saveManual(next);
  }

  const steps = [
    {
      id: "apikey",
      title: "Create an API Key",
      description:
        "Your agent authenticates to LoopStorm Guard using an API key. Generate one now.",
      done: hasApiKeys,
      manual: false,
      cta: (
        <Link
          href="/api-keys"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "0.375rem",
            padding: "0.5rem 1rem",
            backgroundColor: "var(--color-accent-amber)",
            color: "#0a0a0a",
            borderRadius: "0.375rem",
            fontSize: "0.8125rem",
            fontWeight: "600",
            textDecoration: "none",
          }}
        >
          Go to API Keys →
        </Link>
      ),
    },
    {
      id: "install",
      title: "Install the SDK",
      description: "Add the LoopStorm Guard shim to your agent project.",
      done: !!manual.install,
      manual: true,
      code: INSTALL,
    },
    {
      id: "configure",
      title: "Configure Your Environment",
      description: "Set your API key and backend URL as environment variables.",
      done: !!manual.configure,
      manual: true,
      code: CONFIGURE,
    },
    {
      id: "integrate",
      title: "Wrap Your Agent",
      description:
        "Add the Guard wrapper around your agent code. Enforcement and audit logging start immediately.",
      done: !!manual.integrate,
      manual: true,
      code: INTEGRATE,
    },
    {
      id: "run",
      title: "Trigger Your First Run",
      description:
        "Run your agent once. It will appear in the Runs dashboard with full enforcement logs.",
      done: hasRuns,
      manual: false,
      cta: (
        <Link
          href="/runs"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "0.375rem",
            padding: "0.5rem 1rem",
            backgroundColor: "transparent",
            color: "oklch(0.75 0.00 0)",
            border: "1px solid var(--color-border)",
            borderRadius: "0.375rem",
            fontSize: "0.8125rem",
            fontWeight: "500",
            textDecoration: "none",
          }}
        >
          View Runs →
        </Link>
      ),
    },
  ];

  const completedCount = steps.filter((s) => s.done).length;
  const allDone = completedCount === steps.length;
  const pct = Math.round((completedCount / steps.length) * 100);

  return (
    <div
      style={{
        minHeight: "100vh",
        backgroundColor: "var(--color-bg)",
        padding: "2.5rem 1rem 4rem",
      }}
    >
      <div style={{ maxWidth: "48rem", marginInline: "auto" }}>
        {/* ── Header ── */}
        <div style={{ marginBottom: "2.5rem" }}>
          <div style={{ marginBottom: "0.5rem" }}>
            <span
              style={{
                fontSize: "0.75rem",
                fontWeight: "600",
                color: "var(--color-accent-amber)",
                fontFamily: "var(--font-mono)",
                letterSpacing: "0.08em",
                textTransform: "uppercase",
              }}
            >
              Getting Started
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
            Welcome,{" "}
            <span style={{ color: "var(--color-accent-amber)" }}>
              {userName.split(" ")[0]}
            </span>
          </h1>
          <p
            style={{
              fontSize: "0.9375rem",
              color: "oklch(0.58 0.00 0)",
              margin: 0,
            }}
          >
            Complete these steps to connect your first AI agent to LoopStorm Guard.
          </p>
        </div>

        {/* ── Progress bar ── */}
        <div style={{ marginBottom: "2rem" }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: "0.5rem",
            }}
          >
            <span
              style={{ fontSize: "0.8125rem", color: "oklch(0.58 0.00 0)" }}
            >
              {completedCount} of {steps.length} steps complete
            </span>
            <span
              style={{
                fontSize: "0.8125rem",
                fontWeight: "600",
                color: allDone
                  ? "oklch(0.65 0.12 145)"
                  : "var(--color-accent-amber)",
              }}
            >
              {pct}%
            </span>
          </div>
          <div
            style={{
              height: "6px",
              backgroundColor: "oklch(0.15 0.00 0)",
              borderRadius: "999px",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                height: "100%",
                width: `${pct}%`,
                backgroundColor: allDone
                  ? "oklch(0.55 0.15 145)"
                  : "var(--color-accent-amber)",
                borderRadius: "999px",
                transition: "width 0.4s ease",
              }}
            />
          </div>
        </div>

        {/* ── Language toggle ── */}
        <div
          style={{
            display: "flex",
            gap: 0,
            marginBottom: "1.5rem",
            borderBottom: "1px solid var(--color-border)",
          }}
        >
          <LangTab lang="python" active={lang === "python"} onClick={() => setLang("python")} />
          <LangTab lang="typescript" active={lang === "typescript"} onClick={() => setLang("typescript")} />
        </div>

        {/* ── Steps ── */}
        <div style={{ display: "flex", flexDirection: "column", gap: "0.875rem" }}>
          {steps.map((step, i) => (
            <StepCard
              key={step.id}
              number={i + 1}
              title={step.title}
              description={step.description}
              done={step.done}
              manual={step.manual}
              onToggle={step.manual ? () => toggleManual(step.id) : undefined}
            >
              {"code" in step && step.code ? (
                <CodeBlock code={step.code[lang]} lang={lang} />
              ) : null}
              {"cta" in step && step.cta ? (
                <div style={{ marginTop: "0.25rem" }}>{step.cta}</div>
              ) : null}
            </StepCard>
          ))}
        </div>

        {/* ── Footer actions ── */}
        <div
          style={{
            marginTop: "2rem",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: "1rem",
          }}
        >
          {allDone ? (
            <Link
              href="/runs"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "0.5rem",
                padding: "0.625rem 1.25rem",
                backgroundColor: "var(--color-accent-amber)",
                color: "#0a0a0a",
                borderRadius: "0.5rem",
                fontSize: "0.9375rem",
                fontWeight: "600",
                textDecoration: "none",
              }}
            >
              Go to Dashboard →
            </Link>
          ) : (
            <p
              style={{
                fontSize: "0.8125rem",
                color: "oklch(0.45 0.00 0)",
                margin: 0,
              }}
            >
              Complete all steps to unlock your dashboard.
            </p>
          )}
          <Link
            href="/runs"
            style={{
              fontSize: "0.8125rem",
              color: "oklch(0.48 0.00 0)",
              textDecoration: "none",
            }}
          >
            Skip for now →
          </Link>
        </div>
      </div>
    </div>
  );
}
