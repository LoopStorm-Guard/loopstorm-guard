// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Remotion composition — animated hero showing the LoopStorm enforcement
 * pipeline processing tool calls in real time.
 */

import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
  Sequence,
} from "remotion";

/* ── Color constants ──────────────────────────────────────────────────────── */
const BG = "#0a0a0a";
const SURFACE = "#111111";
const BORDER = "#1f1f1f";
const AMBER = "#ff6b00";
const GREEN = "#00c853";
const RED = "#ff3b3b";
const PURPLE = "#9b6dff";
const MONO = "#c4a96b";
const DIM = "#666666";

/* ── Pipeline stages ──────────────────────────────────────────────────────── */
const pipelineStages = [
  { label: "Intercept", color: AMBER },
  { label: "Policy", color: AMBER },
  { label: "Budget", color: AMBER },
  { label: "Loop Check", color: AMBER },
];

/* ── Tool call scenarios ──────────────────────────────────────────────────── */
const scenarios = [
  {
    tool: "web_search",
    args: '{"query": "revenue Q4"}',
    decision: "ALLOW" as const,
    rule: "allow-web-search",
    budget: "$0.12 / $5.00",
    hash: "a1b2c3...f4e5d6",
  },
  {
    tool: "http_get",
    args: '{"url": "169.254.169.254"}',
    decision: "DENY" as const,
    rule: "deny-cloud-metadata",
    budget: "$0.12 / $5.00",
    hash: "f4e5d6...7g8h9i",
  },
  {
    tool: "write_file",
    args: '{"path": "/etc/passwd"}',
    decision: "KILL" as const,
    rule: "deny-system-files",
    budget: "$0.12 / $5.00",
    hash: "7g8h9i...k0l1m2",
  },
];

/* Duration per scenario in frames (at 30fps) */
const SCENARIO_FRAMES = 100;

/* ── Animated dot/particle ────────────────────────────────────────────────── */
function Particle({
  x,
  y,
  size,
  color,
  delay,
}: {
  x: number;
  y: number;
  size: number;
  color: string;
  delay: number;
}) {
  const frame = useCurrentFrame();
  const opacity = interpolate(
    (frame + delay) % 120,
    [0, 60, 120],
    [0.1, 0.6, 0.1],
  );
  return (
    <div
      style={{
        position: "absolute",
        left: x,
        top: y,
        width: size,
        height: size,
        borderRadius: "50%",
        backgroundColor: color,
        opacity,
        filter: `blur(${size > 3 ? 1 : 0}px)`,
      }}
    />
  );
}

/* ── Flowing data dot ─────────────────────────────────────────────────────── */
function FlowDot({
  startX,
  endX,
  y,
  color,
  progress,
}: {
  startX: number;
  endX: number;
  y: number;
  color: string;
  progress: number;
}) {
  const x = interpolate(progress, [0, 1], [startX, endX], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const opacity = interpolate(progress, [0, 0.05, 0.9, 1], [0, 1, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return (
    <div
      style={{
        position: "absolute",
        left: x - 4,
        top: y - 4,
        width: 8,
        height: 8,
        borderRadius: "50%",
        backgroundColor: color,
        opacity,
        boxShadow: `0 0 12px ${color}`,
      }}
    />
  );
}

/* ── Stage box ────────────────────────────────────────────────────────────── */
function StageBox({
  label,
  color,
  x,
  active,
  passed,
}: {
  label: string;
  color: string;
  x: number;
  active: boolean;
  passed: boolean;
}) {
  const borderColor = active ? color : passed ? `${color}66` : BORDER;
  const bgColor = active
    ? `${color}18`
    : passed
      ? `${color}08`
      : SURFACE;
  const textColor = active || passed ? color : DIM;
  const shadow = active ? `0 0 20px ${color}33` : "none";
  return (
    <div
      style={{
        position: "absolute",
        left: x,
        top: 160,
        width: 120,
        height: 44,
        borderRadius: 10,
        border: `1.5px solid ${borderColor}`,
        backgroundColor: bgColor,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
        fontSize: 12,
        fontWeight: 600,
        color: textColor,
        boxShadow: shadow,
        transition: "all 0.3s ease",
      }}
    >
      {label}
    </div>
  );
}

/* ── Decision badge ───────────────────────────────────────────────────────── */
function DecisionBadge({
  decision,
  opacity,
  scale,
}: {
  decision: "ALLOW" | "DENY" | "KILL";
  opacity: number;
  scale: number;
}) {
  const color = decision === "ALLOW" ? GREEN : decision === "DENY" ? RED : RED;
  const bgColor = decision === "ALLOW" ? `${GREEN}20` : `${RED}20`;
  return (
    <div
      style={{
        position: "absolute",
        left: "50%",
        top: 240,
        transform: `translateX(-50%) scale(${scale})`,
        opacity,
        padding: "10px 28px",
        borderRadius: 12,
        border: `2px solid ${color}`,
        backgroundColor: bgColor,
        fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
        fontSize: 20,
        fontWeight: 700,
        color,
        letterSpacing: 3,
        boxShadow: `0 0 30px ${color}44`,
      }}
    >
      {decision}
    </div>
  );
}

/* ── Audit hash line ──────────────────────────────────────────────────────── */
function AuditHash({
  hash,
  opacity,
}: {
  hash: string;
  opacity: number;
}) {
  return (
    <div
      style={{
        position: "absolute",
        left: "50%",
        top: 310,
        transform: "translateX(-50%)",
        opacity,
        fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
        fontSize: 11,
        color: MONO,
        display: "flex",
        alignItems: "center",
        gap: 8,
      }}
    >
      <span style={{ color: DIM }}>audit:</span>
      <span>sha256:{hash}</span>
      <span style={{ color: GREEN }}>chain ✓</span>
    </div>
  );
}

/* ── Tool call label ──────────────────────────────────────────────────────── */
function ToolCallLabel({
  tool,
  args,
  opacity,
}: {
  tool: string;
  args: string;
  opacity: number;
}) {
  return (
    <div
      style={{
        position: "absolute",
        left: "50%",
        top: 100,
        transform: "translateX(-50%)",
        opacity,
        fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
        fontSize: 13,
        display: "flex",
        alignItems: "center",
        gap: 6,
        whiteSpace: "nowrap",
      }}
    >
      <span style={{ color: AMBER }}>▶</span>
      <span style={{ color: "#ccc" }}>{tool}</span>
      <span style={{ color: DIM }}>{args}</span>
    </div>
  );
}

/* ── Single scenario sequence ─────────────────────────────────────────────── */
function ScenarioAnimation({ scenario }: { scenario: (typeof scenarios)[number] }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  /* Phase timings (in frames) */
  const toolAppear = spring({ frame, fps, config: { damping: 15 } });
  const stageProgress = interpolate(frame, [10, 70], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const activeStage = Math.floor(stageProgress * pipelineStages.length);
  const decisionOpacity = interpolate(frame, [72, 82], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const decisionScale = spring({ frame: Math.max(0, frame - 72), fps, config: { damping: 10, mass: 0.5 } });
  const hashOpacity = interpolate(frame, [82, 90], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  /* Pipeline layout */
  const stageWidth = 120;
  const gap = 32;
  const totalWidth = pipelineStages.length * stageWidth + (pipelineStages.length - 1) * gap;
  const startX = (700 - totalWidth) / 2;

  return (
    <AbsoluteFill style={{ backgroundColor: "transparent" }}>
      {/* Tool call label */}
      <ToolCallLabel
        tool={scenario.tool}
        args={scenario.args}
        opacity={toolAppear}
      />

      {/* Pipeline stages */}
      {pipelineStages.map((stage, i) => {
        const x = startX + i * (stageWidth + gap);
        return (
          <StageBox
            key={stage.label}
            label={stage.label}
            color={stage.color}
            x={x}
            active={activeStage === i}
            passed={activeStage > i}
          />
        );
      })}

      {/* Flow dots between stages */}
      {pipelineStages.slice(0, -1).map((_, i) => {
        const dotStartX = startX + (i + 1) * stageWidth + i * gap + gap * 0.2;
        const dotEndX = startX + (i + 1) * (stageWidth + gap) - gap * 0.2;
        const dotProgress = interpolate(
          stageProgress,
          [i / pipelineStages.length, (i + 1) / pipelineStages.length],
          [0, 1],
          { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
        );
        return (
          <FlowDot
            key={i}
            startX={dotStartX}
            endX={dotEndX}
            y={182}
            color={AMBER}
            progress={dotProgress}
          />
        );
      })}

      {/* Connecting lines between stages */}
      {pipelineStages.slice(0, -1).map((_, i) => {
        const lineX = startX + (i + 1) * stageWidth + i * gap;
        const lineOpacity = activeStage > i ? 0.5 : 0.15;
        return (
          <div
            key={`line-${i}`}
            style={{
              position: "absolute",
              left: lineX,
              top: 181,
              width: gap,
              height: 1.5,
              backgroundColor: activeStage > i ? AMBER : BORDER,
              opacity: lineOpacity,
            }}
          />
        );
      })}

      {/* Decision badge */}
      <DecisionBadge
        decision={scenario.decision}
        opacity={decisionOpacity}
        scale={decisionScale}
      />

      {/* Audit hash */}
      <AuditHash hash={scenario.hash} opacity={hashOpacity} />
    </AbsoluteFill>
  );
}

/* ── Main composition ─────────────────────────────────────────────────────── */
export function HeroComposition() {
  const frame = useCurrentFrame();

  /* Background particles */
  const particles = Array.from({ length: 30 }, (_, i) => ({
    x: (i * 137.508) % 700,
    y: (i * 89.233) % 380,
    size: 1.5 + (i % 3),
    color: i % 5 === 0 ? AMBER : i % 7 === 0 ? PURPLE : `${DIM}44`,
    delay: i * 17,
  }));

  return (
    <AbsoluteFill
      style={{
        backgroundColor: BG,
        overflow: "hidden",
      }}
    >
      {/* Ambient gradient */}
      <div
        style={{
          position: "absolute",
          left: "50%",
          top: -40,
          width: 500,
          height: 300,
          transform: "translateX(-50%)",
          background: `radial-gradient(ellipse, ${AMBER}15 0%, transparent 70%)`,
        }}
      />

      {/* Background particles */}
      {particles.map((p, i) => (
        <Particle key={i} {...p} />
      ))}

      {/* Scenario sequences */}
      {scenarios.map((scenario, i) => (
        <Sequence
          key={i}
          from={i * SCENARIO_FRAMES}
          durationInFrames={SCENARIO_FRAMES}
        >
          <ScenarioAnimation scenario={scenario} />
        </Sequence>
      ))}

      {/* Bottom border glow */}
      <div
        style={{
          position: "absolute",
          bottom: 0,
          left: 0,
          right: 0,
          height: 1,
          background: `linear-gradient(90deg, transparent, ${AMBER}44, transparent)`,
        }}
      />
    </AbsoluteFill>
  );
}
