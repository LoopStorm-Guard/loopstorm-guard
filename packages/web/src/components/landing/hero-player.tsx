// SPDX-License-Identifier: AGPL-3.0-only
/**
 * HeroPlayer — wraps the Remotion Player to embed the animated hero
 * composition as an auto-playing, looping inline video on the landing page.
 */

"use client";

import { Player } from "@remotion/player";
import { useEffect, useRef, useState } from "react";
import { HeroComposition } from "./hero-composition";

const FPS = 30;
const SCENARIO_FRAMES = 100;
const TOTAL_SCENARIOS = 3;
const DURATION = SCENARIO_FRAMES * TOTAL_SCENARIOS;

export function HeroPlayer() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      ([entry]) => setIsVisible(entry.isIntersecting),
      { threshold: 0.1 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={containerRef} className="relative overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[#080808] shadow-[0_0_80px_rgba(255,107,0,0.06)]">
      {/* Title bar */}
      <div className="flex items-center gap-2 border-b border-[var(--color-border)] px-4 py-3">
        <span className="h-3 w-3 rounded-full bg-[#ff5f57]" />
        <span className="h-3 w-3 rounded-full bg-[#febc2e]" />
        <span className="h-3 w-3 rounded-full bg-[#28c840]" />
        <span className="ml-3 font-[family-name:var(--font-mono)] text-[11px] text-[oklch(0.4_0_0)]">
          loopstorm guard — enforcement pipeline
        </span>
      </div>

      {/* Remotion Player */}
      <div className="aspect-video w-full">
        {isVisible && (
          <Player
            component={HeroComposition}
            compositionWidth={700}
            compositionHeight={380}
            durationInFrames={DURATION}
            fps={FPS}
            autoPlay
            loop
            style={{ width: "100%", height: "100%" }}
            controls={false}
          />
        )}
      </div>
    </div>
  );
}
