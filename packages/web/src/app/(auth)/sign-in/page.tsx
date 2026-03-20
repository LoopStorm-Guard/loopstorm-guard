// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Sign-in page.
 *
 * Renders the AuthForm in "sign-in" mode. Redirects to /runs on success.
 */

import { AuthForm } from "@/components/auth/auth-form";

export const metadata = {
  title: "Sign In — LoopStorm Guard",
};

export default function SignInPage() {
  return <AuthForm mode="sign-in" />;
}
