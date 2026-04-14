// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Reset-password page.
 *
 * Renders the ResetPasswordForm. Better Auth appends the reset
 * token to the URL as a ?token= search param when it sends the
 * reset-password email. The form reads this token and calls
 * resetPassword on submit.
 */

import { ResetPasswordForm } from "@/components/auth/reset-password-form";

export const metadata = {
  title: "Reset Password — LoopStorm Guard",
};

export default function ResetPasswordPage() {
  return <ResetPasswordForm />;
}
