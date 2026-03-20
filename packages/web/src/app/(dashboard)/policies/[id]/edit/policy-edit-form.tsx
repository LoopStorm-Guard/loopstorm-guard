// SPDX-License-Identifier: AGPL-3.0-only
/**
 * PolicyEditForm — edit form with optimistic concurrency conflict handling.
 *
 * Client component. Captures the policy version at load time. On submit,
 * passes the version to trpc.policies.update. If CONFLICT is returned,
 * shows ConflictDialog with options to re-fetch or overwrite.
 */

"use client";

import { trpc } from "@/lib/trpc-client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ConflictDialog } from "../../conflict-dialog";
import { PolicyEditor } from "../../policy-editor";

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "0.5rem 0.75rem",
  backgroundColor: "var(--color-bg)",
  border: "1px solid var(--color-border)",
  borderRadius: "0.375rem",
  color: "oklch(0.85 0.00 0)",
  fontSize: "0.875rem",
  outline: "none",
  boxSizing: "border-box",
};

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: "0.75rem",
  fontWeight: "500",
  color: "oklch(0.65 0.00 0)",
  textTransform: "uppercase",
  letterSpacing: "0.05em",
  marginBottom: "0.25rem",
};

type PolicyData = {
  id: string;
  name: string;
  description: string | null;
  agent_role: string | null;
  environment: string | null;
  is_active: boolean;
  version: number;
  // content is jsonb in the DB — typed as unknown at the tRPC boundary.
  // The component JSON.stringifies it for the editor and re-parses on submit.
  content: unknown;
};

interface PolicyEditFormProps {
  policy: PolicyData;
}

export function PolicyEditForm({ policy }: PolicyEditFormProps) {
  const router = useRouter();
  const [name, setName] = useState(policy.name);
  const [description, setDescription] = useState(policy.description ?? "");
  const [agentRole, setAgentRole] = useState(policy.agent_role ?? "");
  const [environment, setEnvironment] = useState(policy.environment ?? "");
  const [isActive, setIsActive] = useState(policy.is_active);
  const [content, setContent] = useState(JSON.stringify(policy.content, null, 2));
  const [serverErrors, setServerErrors] = useState<string[]>([]);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [conflictOpen, setConflictOpen] = useState(false);
  const [storedVersion, setStoredVersion] = useState(policy.version);
  const [myVersion, setMyVersion] = useState(policy.version);

  const utils = trpc.useUtils();

  const updateMutation = trpc.policies.update.useMutation({
    onSuccess: () => {
      router.push("/policies");
    },
    onError: (err) => {
      if (err.data?.code === "CONFLICT") {
        // Extract stored version from error message
        const match = err.message.match(/current version: (\d+)/);
        if (match?.[1]) {
          setStoredVersion(Number.parseInt(match[1], 10));
        }
        setConflictOpen(true);
      } else if (err.data?.code === "BAD_REQUEST") {
        // err.cause is not typed on TRPCClientErrorLike — access via Error prototype
        const cause = (err as unknown as { cause?: unknown }).cause;
        if (Array.isArray(cause)) {
          setServerErrors(cause.map((e: { message?: string }) => e.message ?? String(e)));
        } else {
          setServerErrors([err.message]);
        }
      } else {
        setSubmitError(err.message);
      }
    },
  });

  function doSubmit(versionToUse: number) {
    setServerErrors([]);
    setSubmitError(null);

    let parsedContent: Record<string, unknown> | undefined;
    try {
      parsedContent = JSON.parse(content);
    } catch {
      setServerErrors(["Content must be valid JSON"]);
      return;
    }

    setMyVersion(versionToUse);
    updateMutation.mutate({
      id: policy.id,
      version: versionToUse,
      name,
      description: description || null,
      agent_role: agentRole || null,
      environment: environment || null,
      content: parsedContent,
      is_active: isActive,
    });
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    doSubmit(myVersion);
  }

  async function handleConflictRefetch() {
    setConflictOpen(false);
    try {
      const fresh = await utils.policies.get.fetch({ id: policy.id });
      if (fresh) {
        // Reload the page to get fresh data
        router.refresh();
      }
    } catch {
      router.push("/policies");
    }
  }

  function handleConflictOverwrite() {
    setConflictOpen(false);
    // Re-submit with the stored (current) version
    doSubmit(storedVersion);
  }

  return (
    <>
      <form
        onSubmit={handleSubmit}
        style={{
          backgroundColor: "var(--color-surface)",
          border: "1px solid var(--color-border)",
          borderRadius: "0.5rem",
          padding: "1.5rem",
          display: "flex",
          flexDirection: "column",
          gap: "1rem",
        }}
      >
        {submitError && (
          <div
            style={{
              padding: "0.5rem 0.75rem",
              backgroundColor: "rgba(255, 59, 59, 0.08)",
              border: "1px solid rgba(255, 59, 59, 0.3)",
              borderRadius: "0.375rem",
              color: "var(--color-accent-red)",
              fontSize: "0.8125rem",
            }}
            role="alert"
          >
            {submitError}
          </div>
        )}

        <div>
          <label htmlFor="policy-name" style={labelStyle}>
            Name *
          </label>
          <input
            id="policy-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            style={inputStyle}
            data-testid="input-policy-name"
          />
        </div>

        <div>
          <label htmlFor="policy-description" style={labelStyle}>
            Description
          </label>
          <textarea
            id="policy-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            style={{ ...inputStyle, resize: "vertical" }}
            data-testid="input-policy-description"
          />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
          <div>
            <label htmlFor="policy-agent-role" style={labelStyle}>
              Agent Role
            </label>
            <input
              id="policy-agent-role"
              type="text"
              value={agentRole}
              onChange={(e) => setAgentRole(e.target.value)}
              style={inputStyle}
              data-testid="input-agent-role"
            />
          </div>
          <div>
            <label htmlFor="policy-environment" style={labelStyle}>
              Environment
            </label>
            <input
              id="policy-environment"
              type="text"
              value={environment}
              onChange={(e) => setEnvironment(e.target.value)}
              style={inputStyle}
              data-testid="input-environment"
            />
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "0.625rem" }}>
          <input
            id="policy-active"
            type="checkbox"
            checked={isActive}
            onChange={(e) => setIsActive(e.target.checked)}
            data-testid="toggle-is-active"
            style={{ accentColor: "var(--color-accent-amber)", width: "1rem", height: "1rem" }}
          />
          <label
            htmlFor="policy-active"
            style={{ fontSize: "0.875rem", color: "oklch(0.70 0.00 0)", cursor: "pointer" }}
          >
            Active policy
          </label>
        </div>

        <PolicyEditor value={content} onChange={setContent} serverErrors={serverErrors} />

        <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end" }}>
          <button
            type="button"
            onClick={() => router.push("/policies")}
            style={{
              padding: "0.5rem 1rem",
              backgroundColor: "transparent",
              border: "1px solid var(--color-border)",
              borderRadius: "0.375rem",
              color: "oklch(0.60 0.00 0)",
              fontSize: "0.875rem",
              cursor: "pointer",
            }}
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={updateMutation.isPending}
            data-testid="btn-save-policy"
            style={{
              padding: "0.5rem 1rem",
              backgroundColor: "rgba(255, 107, 0, 0.15)",
              border: "1px solid rgba(255, 107, 0, 0.4)",
              borderRadius: "0.375rem",
              color: "var(--color-accent-amber)",
              fontSize: "0.875rem",
              fontWeight: "500",
              cursor: updateMutation.isPending ? "not-allowed" : "pointer",
              opacity: updateMutation.isPending ? 0.7 : 1,
            }}
          >
            {updateMutation.isPending ? "Saving…" : "Save Changes"}
          </button>
        </div>
      </form>

      <ConflictDialog
        open={conflictOpen}
        currentVersion={myVersion}
        storedVersion={storedVersion}
        onRefetch={handleConflictRefetch}
        onOverwrite={handleConflictOverwrite}
        onCancel={() => setConflictOpen(false)}
        isLoading={updateMutation.isPending}
      />
    </>
  );
}
