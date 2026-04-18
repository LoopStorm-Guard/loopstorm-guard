// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Sign-in page.
 *
 * Renders the AuthForm in "sign-in" mode. Redirects to /runs on success.
 * When the user arrives with `?verified=1` (just signed up) we also render
 * the ResendVerificationLink so they can request a fresh verification email
 * without contacting support.
 */

import { AuthForm } from "@/components/auth/auth-form";
import { ResendVerificationLink } from "@/components/auth/resend-verification-link";

export const metadata = {
  title: "Sign In — LoopStorm Guard",
};

interface SignInPageProps {
  searchParams: Promise<{ verified?: string }>;
}

export default async function SignInPage({ searchParams }: SignInPageProps) {
  const { verified } = await searchParams;
  return (
    <>
      {verified === "1" && <ResendVerificationLink />}
      <AuthForm mode="sign-in" />
    </>
  );
}
