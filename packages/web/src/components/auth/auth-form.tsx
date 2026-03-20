// SPDX-License-Identifier: AGPL-3.0-only
/**
 * AuthForm — email/password sign-in and sign-up form with Google OAuth.
 *
 * Uses the Better Auth React client (never Supabase Auth). On success:
 * - sign-in: redirects to /runs
 * - sign-up: redirects to /sign-in?verified=1 (pending email verification)
 */

"use client";

import { signIn, signUp } from "@/lib/auth-client";
import { useRouter } from "next/navigation";
import { useState } from "react";

interface AuthFormProps {
  mode: "sign-in" | "sign-up";
}

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

const btnSecondaryStyle: React.CSSProperties = {
  width: "100%",
  padding: "0.5rem 1rem",
  backgroundColor: "transparent",
  color: "oklch(0.75 0.00 0)",
  border: "1px solid var(--color-border)",
  borderRadius: "0.375rem",
  fontSize: "0.875rem",
  fontWeight: "500",
  cursor: "pointer",
};

const errorStyle: React.CSSProperties = {
  padding: "0.5rem 0.75rem",
  backgroundColor: "rgba(255, 59, 59, 0.1)",
  border: "1px solid rgba(255, 59, 59, 0.3)",
  borderRadius: "0.375rem",
  color: "var(--color-accent-red)",
  fontSize: "0.8125rem",
};

export function AuthForm({ mode }: AuthFormProps) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);

  const isSignIn = mode === "sign-in";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setLoading(true);

    try {
      if (isSignIn) {
        const result = await signIn.email({ email, password, callbackURL: "/runs" });
        if (result.error) {
          setError(result.error.message ?? "Sign-in failed. Please check your credentials.");
        } else {
          router.push("/runs");
        }
      } else {
        const result = await signUp.email({
          name,
          email,
          password,
          callbackURL: "/runs",
        });
        if (result.error) {
          setError(result.error.message ?? "Sign-up failed. Please try again.");
        } else {
          setSuccess("Account created. Check your email to verify your address, then sign in.");
          setTimeout(() => router.push("/sign-in?verified=1"), 2000);
        }
      }
    } catch {
      setError("An unexpected error occurred. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  async function handleGoogleSignIn() {
    setError(null);
    setLoading(true);
    try {
      await signIn.social({ provider: "google", callbackURL: "/runs" });
    } catch {
      setError("Google sign-in failed. Please try again.");
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
          marginBottom: "1.25rem",
          marginTop: 0,
        }}
      >
        {isSignIn ? "Sign in to your account" : "Create an account"}
      </h2>

      {error && (
        <div style={{ ...errorStyle, marginBottom: "1rem" }} role="alert" data-testid="auth-error">
          {error}
        </div>
      )}

      {success && (
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
          data-testid="auth-success"
        >
          {success}
        </output>
      )}

      <form
        onSubmit={handleSubmit}
        style={{ display: "flex", flexDirection: "column", gap: "0.875rem" }}
      >
        {!isSignIn && (
          <div>
            <label htmlFor="name" style={labelStyle}>
              Full Name
            </label>
            <input
              id="name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required={!isSignIn}
              autoComplete="name"
              style={inputStyle}
              data-testid="input-name"
            />
          </div>
        )}

        <div>
          <label htmlFor="email" style={labelStyle}>
            Email address
          </label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete={isSignIn ? "email" : "email"}
            style={inputStyle}
            data-testid="input-email"
          />
        </div>

        <div>
          <label htmlFor="password" style={labelStyle}>
            Password
          </label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete={isSignIn ? "current-password" : "new-password"}
            style={inputStyle}
            data-testid="input-password"
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
          data-testid="btn-submit"
        >
          {loading ? "Please wait…" : isSignIn ? "Sign in" : "Create account"}
        </button>
      </form>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.75rem",
          margin: "1rem 0",
        }}
      >
        <div style={{ flex: 1, height: "1px", backgroundColor: "var(--color-border)" }} />
        <span style={{ fontSize: "0.75rem", color: "oklch(0.50 0.00 0)" }}>or</span>
        <div style={{ flex: 1, height: "1px", backgroundColor: "var(--color-border)" }} />
      </div>

      <button
        type="button"
        onClick={handleGoogleSignIn}
        disabled={loading}
        style={{
          ...btnSecondaryStyle,
          opacity: loading ? 0.7 : 1,
          cursor: loading ? "not-allowed" : "pointer",
        }}
        data-testid="btn-google"
      >
        Continue with Google
      </button>

      <p
        style={{
          marginTop: "1.25rem",
          marginBottom: 0,
          textAlign: "center",
          fontSize: "0.8125rem",
          color: "oklch(0.55 0.00 0)",
        }}
      >
        {isSignIn ? (
          <>
            No account?{" "}
            <a
              href="/sign-up"
              style={{ color: "var(--color-accent-amber)", textDecoration: "none" }}
            >
              Sign up
            </a>
          </>
        ) : (
          <>
            Already have an account?{" "}
            <a
              href="/sign-in"
              style={{ color: "var(--color-accent-amber)", textDecoration: "none" }}
            >
              Sign in
            </a>
          </>
        )}
      </p>
    </div>
  );
}
