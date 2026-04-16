// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Onboarding page — server component.
 *
 * Checks auth, fetches live progress data (API keys + runs), and passes
 * it to the interactive client component.
 */

import { createServerTRPCClient } from "@/lib/trpc-server";
import { getAuthBaseURL } from "@/lib/env";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { OnboardingClient } from "./onboarding-client";

export const metadata = {
  title: "Get Started — LoopStorm Guard",
};

async function getSession() {
  try {
    const cookieStore = await cookies();
    const cookieHeader = cookieStore.toString();
    const baseURL = getAuthBaseURL();
    const url = baseURL
      ? `${baseURL}/api/auth/get-session`
      : "http://localhost:3001/api/auth/get-session";

    const res = await fetch(url, {
      headers: { cookie: cookieHeader },
      cache: "no-store",
    });
    if (!res.ok) return null;
    return (await res.json()) ?? null;
  } catch {
    return null;
  }
}

export default async function OnboardingPage() {
  const session = await getSession();
  if (!session?.user) redirect("/sign-in");

  const trpc = await createServerTRPCClient();

  let hasApiKeys = false;
  let hasRuns = false;

  try {
    const keys = await trpc.apiKeys.list.query({ limit: 1 });
    hasApiKeys = keys.items.length > 0;
  } catch {}

  try {
    const runs = await trpc.runs.list.query({ limit: 1 });
    hasRuns = runs.items.length > 0;
  } catch {}

  return (
    <OnboardingClient
      userName={session.user.name || session.user.email}
      hasApiKeys={hasApiKeys}
      hasRuns={hasRuns}
    />
  );
}
