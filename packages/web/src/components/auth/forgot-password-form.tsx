// SPDX-License-Identifier: AGPL-3.0-only
/**
 * ForgotPasswordForm — email input that triggers a Better Auth
 * password-reset email via forgetPassword().
 *
 * Shows a generic success message regardless of whether the email
 * exists, to avoid leaking account information.
 */

"use client";

import { forgetPassword } from "@/lib/auth-client";
import { useState } from "react";

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

const btnPrimaryStyle: React.CSSProperties = {
  width: "100%",
  padding: "0.5rem 1rem",
  backgroundColor: "var(--color-accent-amber)",
  color: "#0a0a0a",
  border: "none",
  borderRadius: "0.375rem",
  fontSize: "0.875rem",
  fontWeight: "600",
  cursor: "pointer",
};

export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  // Deliberately no `error` state. The UI must present an identical outcome
  // whether the email belongs to a registered account, is unregistered, is
  // rate-limited, or hits a network error. Surfacing any distinguishing signal
  // here enables account enumeration. Any internal error is logged to the
  // console for developer visibility only.
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);

    try {
      const result = await forgetPassword({
        email,
        redirectTo: "/reset-password",
      });
      if (result.error) {
        console.warn("[forgot-password] server returned error", result.error);
      }
    } catch (err) {
      console.warn("[forgot-password] network error", err);
    } finally {
      setSubmitted(true);
      setLoading(false);
    }
  }

  return (
    <div>
      <h2
        style={{
          fontSize: "1rem",
          fontWeight: "600",
          color: "oklch(0.85 0.00 0)",
          marginBottom: "0.5rem",
          marginTop: 0,
        }}
      >
        Forgot your password?
      </h2>
      <p
        style={{
          fontSize: "0.8125rem",
          color: "oklch(0.55 0.00 0)",
          marginTop: 0,
          marginBottom: "1.25rem",
        }}
      >
        Enter your email and we'll send you a reset link.
      </p>

      {submitted ? (
        <output
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
          data-testid="forgot-password-success"
        >
          If an account exists for that email, a reset link has been sent.
        </output>
      ) : (
        <form
          onSubmit={handleSubmit}
          style={{ display: "flex", flexDirection: "column", gap: "0.875rem" }}
        >
          <div>
            <label htmlFor="forgot-email" style={labelStyle}>
              Email address
            </label>
            <input
              id="forgot-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
              style={inputStyle}
              data-testid="input-forgot-email"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            style={{
              ...btnPrimaryStyle,
              opacity: loading ? 0.7 : 1,
              cursor: loading ? "not-allowed" : "pointer",
            }}
            data-testid="btn-send-reset"
          >
            {loading ? "Sending…" : "Send reset link"}
          </button>
        </form>
      )}

      <p
        style={{
          marginTop: "1.25rem",
          marginBottom: 0,
          textAlign: "center",
          fontSize: "0.8125rem",
          color: "oklch(0.55 0.00 0)",
        }}
      >
        <a
          href="/sign-in"
          style={{ color: "var(--color-accent-amber)", textDecoration: "none" }}
          data-testid="link-back-to-sign-in"
        >
          Back to sign in
        </a>
      </p>
    </div>
  );
}
