// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Create policy page — client component for form handling.
 *
 * Calls trpc.policies.create on submit. Validates content JSON locally
 * before submission. Displays server-side validation errors inline.
 */

"use client";

import { PageHeader } from "@/components/ui/page-header";
import { trpc } from "@/lib/trpc-client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { PolicyEditor } from "../policy-editor";

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

export default function NewPolicyPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [agentRole, setAgentRole] = useState("");
  const [environment, setEnvironment] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [content, setContent] = useState('{\n  "schema_version": 1,\n  "rules": []\n}');
  const [serverErrors, setServerErrors] = useState<string[]>([]);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const createMutation = trpc.policies.create.useMutation({
    onSuccess: () => {
      router.push("/policies");
    },
    onError: (err) => {
      if (err.data?.code === "BAD_REQUEST") {
        // Extract validation errors from the cause
        const cause = err.cause;
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

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setServerErrors([]);
    setSubmitError(null);

    // Validate JSON locally first
    let parsedContent: Record<string, unknown>;
    try {
      parsedContent = JSON.parse(content);
    } catch {
      setServerErrors(["Content must be valid JSON"]);
      return;
    }

    createMutation.mutate({
      name,
      description: description || undefined,
      agent_role: agentRole || undefined,
      environment: environment || undefined,
      content: parsedContent,
      is_active: isActive,
    });
  }

  return (
    <div>
      <PageHeader
        title="Create Policy"
        description="Define enforcement rules for agent tool calls"
      />

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
            placeholder="e.g. production-strict"
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
            placeholder="Optional description"
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
              placeholder="e.g. code-assistant"
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
              placeholder="e.g. production"
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
            Activate this policy immediately
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
            disabled={createMutation.isPending}
            data-testid="btn-create-policy-submit"
            style={{
              padding: "0.5rem 1rem",
              backgroundColor: "rgba(255, 107, 0, 0.15)",
              border: "1px solid rgba(255, 107, 0, 0.4)",
              borderRadius: "0.375rem",
              color: "var(--color-accent-amber)",
              fontSize: "0.875rem",
              fontWeight: "500",
              cursor: createMutation.isPending ? "not-allowed" : "pointer",
              opacity: createMutation.isPending ? 0.7 : 1,
            }}
          >
            {createMutation.isPending ? "Creating…" : "Create Policy"}
          </button>
        </div>
      </form>
    </div>
  );
}
