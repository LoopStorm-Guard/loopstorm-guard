// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import { useState } from "react";

interface FAQItem {
  question: string;
  answer: string;
}

const faqItems: FAQItem[] = [
  {
    question: "How much latency does LoopStorm add?",
    answer:
      "Less than 1ms P99 per tool call. The enforcement engine is written in Rust, runs locally in-process via IPC (Unix domain socket), and does zero network I/O in Mode 0. Policy evaluation is a single-pass first-match lookup — no ML inference, no API calls. Your agent won't notice it's there.",
  },
  {
    question: "How long does integration take?",
    answer:
      'Under 2 minutes. For Python: pip install loopstorm-py, add @guard(policy="loopstorm.yaml") to your agent, and define your rules. For TypeScript: bun add loopstorm-ts with a similar one-line wrapper. No infrastructure, no account, no config server.',
  },
  {
    question: "Does it work without an internet connection?",
    answer:
      "Yes — that's Mode 0, and it's the default. The engine, CLI, and shims run entirely locally. No telemetry, no license server, no phone-home. Audit logs stay on disk. You can air-gap it completely. The cloud dashboard (Mode 2) is optional, for teams that want cross-run analytics.",
  },
  {
    question: "What AI frameworks does it support?",
    answer:
      "LoopStorm intercepts at the tool-call level, so it works with any framework that makes tool calls: LangChain, LlamaIndex, CrewAI, AutoGen, custom agents, or raw OpenAI/Anthropic SDK usage. Python and TypeScript shims are included. The Rust engine speaks a simple JSON-over-IPC protocol if you need to integrate from another language.",
  },
  {
    question: "How is this different from guardrails libraries?",
    answer:
      "Most guardrails libraries validate LLM output text (prompt injection, toxicity). LoopStorm operates at the tool-call boundary — it controls what your agent can do, not what it says. Policy rules, budget caps, and loop detection are deterministic (no AI in the critical path). It's an enforcement layer, not a content filter.",
  },
  {
    question: "Is the open-source version production-ready?",
    answer:
      "Yes. The MIT-licensed engine has 67+ unit tests, 11 integration tests, and 4 end-to-end case studies covering budget exhaustion, loop detection, policy deny, and escalation. The audit log uses SHA-256 hash chains that are CLI-verifiable. It's the same engine that powers the cloud version — there's no \"lite\" edition.",
  },
];

export function FAQAccordion() {
  const [openIndex, setOpenIndex] = useState<number | null>(0);

  return (
    <div className="mx-auto max-w-3xl">
      {faqItems.map((item, i) => {
        const isOpen = openIndex === i;
        return (
          <div key={item.question} className="border-b border-[var(--color-border)]">
            <button
              type="button"
              onClick={() => setOpenIndex(isOpen ? null : i)}
              className="flex w-full items-center justify-between py-6 text-left transition-colors duration-200 hover:text-white"
            >
              <span
                className={`pr-8 text-[15px] font-semibold transition-colors duration-200 ${isOpen ? "text-white" : "text-[oklch(0.7_0_0)]"}`}
              >
                {item.question}
              </span>
              <span
                className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border transition-all duration-300 ${
                  isOpen
                    ? "border-[var(--color-accent-amber)] bg-[rgba(255,107,0,0.1)] text-[var(--color-accent-amber)]"
                    : "border-[var(--color-border)] bg-[var(--color-surface)] text-[oklch(0.5_0_0)]"
                }`}
              >
                <svg
                  aria-hidden="true"
                  className={`h-3.5 w-3.5 transition-transform duration-300 ${isOpen ? "rotate-45" : ""}`}
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M12 5v14" />
                  <path d="M5 12h14" />
                </svg>
              </span>
            </button>
            <div
              className="grid transition-all duration-300 ease-in-out"
              style={{
                gridTemplateRows: isOpen ? "1fr" : "0fr",
              }}
            >
              <div className="overflow-hidden">
                <p className="pb-6 text-sm leading-relaxed text-[oklch(0.5_0_0)]">{item.answer}</p>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
