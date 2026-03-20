// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Dashboard home — redirects to /runs.
 */

import { redirect } from "next/navigation";

export default function DashboardPage() {
  redirect("/runs");
}
