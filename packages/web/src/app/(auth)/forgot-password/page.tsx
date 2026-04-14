// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Forgot-password page.
 *
 * Renders the ForgotPasswordForm. The form calls Better Auth's
 * forgetPassword method and shows a generic success message to
 * avoid leaking which email addresses have accounts.
 */

import { ForgotPasswordForm } from "@/components/auth/forgot-password-form";

export const metadata = {
  title: "Forgot Password — LoopStorm Guard",
};

export default function ForgotPasswordPage() {
  return <ForgotPasswordForm />;
}
