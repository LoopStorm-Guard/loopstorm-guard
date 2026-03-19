// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Edit policy page — server component fetches policy, client component handles form.
 */

import { notFound } from "next/navigation";
import { createServerTRPCClient } from "@/lib/trpc-server";
import { PageHeader } from "@/components/ui/page-header";
import { PolicyEditForm } from "./policy-edit-form";

interface EditPolicyPageProps {
  params: Promise<{ id: string }>;
}

export default async function EditPolicyPage({ params }: EditPolicyPageProps) {
  const { id } = await params;
  const trpc = await createServerTRPCClient();

  let policy: Awaited<ReturnType<typeof trpc.policies.get>> = null;
  try {
    policy = await trpc.policies.get({ id });
  } catch {
    // If fetch fails, show not found
  }

  if (!policy) {
    notFound();
  }

  return (
    <div>
      <PageHeader title={`Edit: ${policy.name}`} description={`Version ${policy.version} · ${policy.is_active ? "Active" : "Inactive"}`} />
      <PolicyEditForm policy={policy} />
    </div>
  );
}
