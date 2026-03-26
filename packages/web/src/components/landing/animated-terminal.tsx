// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import { useEffect, useRef, useState } from "react";

interface TerminalLine {
  type: "dim" | "info" | "amber" | "green" | "red" | "hash";
  text: string;
}

const lines: TerminalLine[] = [
  { type: "dim", text: "$ python agent.py" },
  { type: "dim", text: "" },
  { type: "info", text: "[loopstorm] policy loaded: 4 rules, budget $5.00" },
  { type: "dim", text: "" },
  { type: "amber", text: '\u25b6 agent requests: web_search({query: "quarterly revenue"})' },
  { type: "info", text: "  \u251c\u2500 policy:    allow-web-search    \u2192 ALLOW" },
  { type: "info", text: "  \u251c\u2500 budget:    $0.12 / $5.00       \u2192 OK (2.4%)" },
  { type: "info", text: "  \u251c\u2500 loop:      fingerprint unique   \u2192 OK" },
  { type: "green", text: "  \u2514\u2500 decision:  ALLOW               (0.8ms)" },
  { type: "hash", text: "  audit: ...a1b2c3 \u2192 sha256:f4e5d6   chain \u2713" },
  { type: "dim", text: "" },
  { type: "amber", text: '\u25b6 agent requests: http_get({url: "169.254.169.254/metadata"})' },
  { type: "info", text: "  \u251c\u2500 policy:    deny-cloud-metadata  \u2192 DENY" },
  { type: "red", text: "  \u2514\u2500 decision:  DENY                (0.3ms)" },
  { type: "hash", text: "  audit: ...f4e5d6 \u2192 sha256:7g8h9i   chain \u2713" },
  { type: "dim", text: "" },
  { type: "amber", text: '\u25b6 agent requests: write_file({path: "/etc/passwd"})' },
  { type: "info", text: "  \u251c\u2500 policy:    deny-system-files   \u2192 DENY" },
  { type: "info", text: "  \u251c\u2500 loop:      3x same fingerprint  \u2192 LOOP DETECTED" },
  { type: "red", text: "  \u2514\u2500 decision:  KILL (escalate_to_human)" },
  { type: "hash", text: "  audit: ...7g8h9i \u2192 sha256:k0l1m2   chain \u2713" },
];

const colorMap: Record<TerminalLine["type"], string> = {
  dim: "oklch(0.4 0 0)",
  info: "oklch(0.6 0 0)",
  amber: "var(--color-accent-amber)",
  green: "var(--color-accent-green)",
  red: "var(--color-accent-red)",
  hash: "var(--color-mono)",
};

export function AnimatedTerminal() {
  const [visibleCount, setVisibleCount] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const startedRef = useRef(false);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !startedRef.current) {
          startedRef.current = true;
          observer.unobserve(el);
          let i = 0;
          const interval = setInterval(() => {
            i++;
            setVisibleCount(i);
            if (i >= lines.length) clearInterval(interval);
          }, 180);
        }
      },
      { threshold: 0.3 }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={containerRef}
      className="overflow-hidden rounded-xl border border-[var(--color-border)] bg-[#080808] shadow-[0_0_80px_rgba(255,107,0,0.06)]"
    >
      {/* Title bar */}
      <div className="flex items-center gap-2 border-b border-[var(--color-border)] px-4 py-3">
        <span className="h-3 w-3 rounded-full bg-[#ff5f57]" />
        <span className="h-3 w-3 rounded-full bg-[#febc2e]" />
        <span className="h-3 w-3 rounded-full bg-[#28c840]" />
        <span className="ml-3 font-[family-name:var(--font-mono)] text-[11px] text-[oklch(0.4_0_0)]">
          loopstorm — enforcement log
        </span>
      </div>

      {/* Terminal body */}
      <div className="h-[380px] overflow-hidden px-5 py-4">
        {lines.slice(0, visibleCount).map((line) => (
          <div
            key={line.text}
            className="terminal-line font-[family-name:var(--font-mono)] text-[13px] leading-[1.8]"
            style={{ color: colorMap[line.type] }}
          >
            {line.text || "\u00a0"}
          </div>
        ))}
        {visibleCount < lines.length && (
          <span className="terminal-cursor inline-block h-[14px] w-[7px] bg-[var(--color-accent-amber)]" />
        )}
      </div>
    </div>
  );
}
