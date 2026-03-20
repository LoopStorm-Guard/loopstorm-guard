// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Sign-up page.
 *
 * Renders the AuthForm in "sign-up" mode. Redirects to /sign-in on success
 * with a "check your email" message if email verification is required.
 */

import { AuthForm } from "@/components/auth/auth-form";

export const metadata = {
  title: "Sign Up — LoopStorm Guard",
};

export default function SignUpPage() {
  return <AuthForm mode="sign-up" />;
}
