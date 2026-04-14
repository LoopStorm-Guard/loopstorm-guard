// SPDX-License-Identifier: AGPL-3.0-only
/**
 * ResetPasswordForm — reads the ?token= search param from the
 * Better Auth password-reset email link, accepts a new password,
 * and calls resetPassword() on submit.
 *
 * On success the user is redirected to /sign-in.
 */

"use client";

import { resetPassword } from "@/lib/auth-client";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";

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

function ResetPasswordFormInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token");

  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!token) {
      setError("Reset token is missing. Please use the link from your email.");
      return;
    }

    if (newPassword !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    if (newPassword.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }

    setLoading(true);

    try {
      const result = await resetPassword({
        newPassword,
        token,
      });
      if (result.error) {
        setError(result.error.message ?? "Failed to reset password. Please request a new link.");
      } else {
        setSuccess(true);
        setTimeout(() => router.push("/sign-in"), 2000);
      }
    } catch {
      setError("An unexpected error occurred. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  if (!token) {
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
          Invalid reset link
        </h2>
        <div
          style={{
            padding: "0.5rem 0.75rem",
            backgroundColor: "rgba(255, 59, 59, 0.1)",
            border: "1px solid rgba(255, 59, 59, 0.3)",
            borderRadius: "0.375rem",
            color: "var(--color-accent-red)",
            fontSize: "0.8125rem",
            marginBottom: "1rem",
          }}
          role="alert"
          data-testid="reset-password-missing-token"
        >
          Reset token is missing. Please use the link from your password-reset email or{" "}
          <a
            href="/forgot-password"
            style={{ color: "var(--color-accent-amber)", textDecoration: "none" }}
          >
            request a new one
          </a>
          .
        </div>
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
        Set a new password
      </h2>
      <p
        style={{
          fontSize: "0.8125rem",
          color: "oklch(0.55 0.00 0)",
          marginTop: 0,
          marginBottom: "1.25rem",
        }}
      >
        Choose a strong password for your account.
      </p>

      {error && (
        <div
          style={{
            padding: "0.5rem 0.75rem",
            backgroundColor: "rgba(255, 59, 59, 0.1)",
            border: "1px solid rgba(255, 59, 59, 0.3)",
            borderRadius: "0.375rem",
            color: "var(--color-accent-red)",
            fontSize: "0.8125rem",
            marginBottom: "1rem",
          }}
          role="alert"
          data-testid="reset-password-error"
        >
          {error}
        </div>
      )}

      {success ? (
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
          data-testid="reset-password-success"
        >
          Password updated. Redirecting…
        </output>
      ) : (
        <form
          onSubmit={handleSubmit}
          style={{ display: "flex", flexDirection: "column", gap: "0.875rem" }}
        >
          <div>
            <label htmlFor="new-password" style={labelStyle}>
              New password
            </label>
            <input
              id="new-password"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
              autoComplete="new-password"
              minLength={8}
              style={inputStyle}
              data-testid="input-new-password"
            />
          </div>

          <div>
            <label htmlFor="confirm-password" style={labelStyle}>
              Confirm password
            </label>
            <input
              id="confirm-password"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              autoComplete="new-password"
              minLength={8}
              style={inputStyle}
              data-testid="input-confirm-password"
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
            data-testid="btn-reset-password"
          >
            {loading ? "Updating…" : "Update password"}
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

/**
 * Exported wrapper — useSearchParams() requires a Suspense boundary
 * when used in a page rendered during static generation.
 */
export function ResetPasswordForm() {
  return (
    <Suspense
      fallback={
        <p
          style={{
            fontSize: "0.875rem",
            color: "oklch(0.55 0.00 0)",
            textAlign: "center",
            margin: 0,
          }}
        >
          Loading…
        </p>
      }
    >
      <ResetPasswordFormInner />
    </Suspense>
  );
}
