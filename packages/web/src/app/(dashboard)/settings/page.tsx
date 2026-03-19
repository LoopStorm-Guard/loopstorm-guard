// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Settings page — stub placeholder for v1.
 *
 * Full tenant settings are deferred to v2 per the P4 task brief.
 */

import { PageHeader } from "@/components/ui/page-header";

export const metadata = {
  title: "Settings — LoopStorm Guard",
};

export default function SettingsPage() {
  return (
    <div>
      <PageHeader
        title="Settings"
        description="Tenant configuration and preferences"
      />
      <div
        style={{
          backgroundColor: "var(--color-surface)",
          border: "1px solid var(--color-border)",
          borderRadius: "0.5rem",
          padding: "2rem",
          textAlign: "center",
        }}
      >
        <p style={{ color: "oklch(0.55 0.00 0)", fontSize: "0.875rem", margin: 0 }}>
          Tenant settings are coming in v2. For now, manage your account via the API or CLI.
        </p>
      </div>
    </div>
  );
}
