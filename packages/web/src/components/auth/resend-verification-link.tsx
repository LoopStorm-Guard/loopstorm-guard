// SPDX-License-Identifier: AGPL-3.0-only
/**
 * ResendVerificationLink — one-button component for requesting a new
 * email-verification send. Rendered alongside the sign-in form when the user
 * arrives from `/sign-up` (`?verified=1`) and needs to re-request the email.
 *
 * The real enforcement (per-IP, per-email, 60s cooldown, daily cap) happens
 * server-side. This component's `localStorage` cooldown is a UX hint only —
 * it prevents rapid accidental clicks but the server is always the source of
 * truth. We also never surface distinguishing error messages to the DOM:
 * registered, unregistered, and rate-limited email addresses all produce the
 * same success message.
 */

"use client";

import { sendVerificationEmail } from "@/lib/auth-client";
import { useEffect, useState } from "react";

const COOLDOWN_MS = 60_000;
const LS_KEY = "lsg_resend_verification_until";

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "0.5rem 0.75rem",
  backgroundColor: "var(--color-bg)",
  border: "1px solid var(--color-border)",
  borderRadius: "0.375rem",
  color: "oklch(0.92 0.00 0)",
  fontSize: "0.875rem",
  outline: "none",
};

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: "0.75rem",
  fontWeight: "500",
  color: "oklch(0.65 0.00 0)",
  marginBottom: "0.25rem",
  textTransform: "uppercase",
  letterSpacing: "0.05em",
};

const btnStyle: React.CSSProperties = {
  width: "100%",
  padding: "0.5rem 1rem",
  backgroundColor: "transparent",
  color: "oklch(0.75 0.00 0)",
  border: "1px solid var(--color-border)",
  borderRadius: "0.375rem",
  fontSize: "0.8125rem",
  fontWeight: "500",
  cursor: "pointer",
};

export function ResendVerificationLink() {
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(0);

  useEffect(() => {
    // Rehydrate cooldown from localStorage so a refresh doesn't reset it.
    const until = Number(localStorage.getItem(LS_KEY) ?? "0");
    const remainingMs = until - Date.now();
    if (remainingMs > 0) setSecondsLeft(Math.ceil(remainingMs / 1000));

    const t = setInterval(() => {
      const now = Date.now();
      const u = Number(localStorage.getItem(LS_KEY) ?? "0");
      const rem = u - now;
      setSecondsLeft(rem > 0 ? Math.ceil(rem / 1000) : 0);
    }, 1000);
    return () => clearInterval(t);
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      await sendVerificationEmail({ email });
    } catch (err) {
      // Never surface. Log only for dev debugging.
      console.warn("[resend-verification] network error", err);
    } finally {
      localStorage.setItem(LS_KEY, String(Date.now() + COOLDOWN_MS));
      setSecondsLeft(Math.ceil(COOLDOWN_MS / 1000));
      setSubmitted(true);
      setLoading(false);
    }
  }

  if (submitted) {
    return (
      <output
        data-testid="resend-verification-success"
        style={{
          display: "block",
          padding: "0.5rem 0.75rem",
          backgroundColor: "rgba(0, 200, 83, 0.1)",
          border: "1px solid rgba(0, 200, 83, 0.3)",
          borderRadius: "0.375rem",
          color: "var(--color-accent-green)",
          fontSize: "0.8125rem",
          marginBottom: "1rem",
        }}
      >
        If that email matches an unverified account, a new verification link has been sent.
      </output>
    );
  }

  const disabled = loading || secondsLeft > 0;

  return (
    <form
      onSubmit={handleSubmit}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "0.5rem",
        padding: "0.75rem",
        border: "1px solid var(--color-border)",
        borderRadius: "0.375rem",
        marginBottom: "1rem",
      }}
      data-testid="resend-verification-form"
    >
      <p style={{ margin: 0, fontSize: "0.8125rem", color: "oklch(0.65 0.00 0)" }}>
        Didn't receive the verification email?
      </p>
      <div>
        <label htmlFor="resend-email" style={labelStyle}>
          Email address
        </label>
        <input
          id="resend-email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          autoComplete="email"
          style={inputStyle}
          data-testid="input-resend-email"
        />
      </div>
      <button
        type="submit"
        disabled={disabled}
        style={{
          ...btnStyle,
          opacity: disabled ? 0.6 : 1,
          cursor: disabled ? "not-allowed" : "pointer",
        }}
        data-testid="btn-resend-verification"
      >
        {secondsLeft > 0
          ? `Resend available in ${secondsLeft}s`
          : loading
            ? "Sending…"
            : "Resend verification email"}
      </button>
    </form>
  );
}
