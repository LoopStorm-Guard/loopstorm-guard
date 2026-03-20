// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Root page — redirects to /runs (dashboard) or /sign-in.
 *
 * The session check is handled by the (dashboard) layout's auth guard.
 * This page simply redirects to the primary dashboard screen.
 *
 * IMPORTANT: This file is licensed AGPL-3.0-only (ADR-013).
 */

import { redirect } from "next/navigation";

export default function RootPage() {
  redirect("/runs");
}
