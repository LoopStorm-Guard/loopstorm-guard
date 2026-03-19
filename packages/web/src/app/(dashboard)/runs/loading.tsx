// SPDX-License-Identifier: AGPL-3.0-only
export default function RunsLoading() {
  return (
    <div style={{ opacity: 0.5 }}>
      <div style={{ height: "2rem", width: "8rem", backgroundColor: "var(--color-border)", borderRadius: "0.375rem", marginBottom: "1.5rem" }} />
      <div style={{ backgroundColor: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: "0.5rem", padding: "1rem" }}>
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} style={{ height: "2.5rem", backgroundColor: "var(--color-border)", borderRadius: "0.25rem", marginBottom: "0.5rem" }} />
        ))}
      </div>
    </div>
  );
}
