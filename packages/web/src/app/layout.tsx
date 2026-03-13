// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Root layout for the LoopStorm Guard web UI.
 *
 * IMPORTANT: This file is licensed AGPL-3.0-only. Do not import it from
 * any MIT-licensed package (ADR-013).
 */

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "LoopStorm Guard",
  description: "Runtime enforcement layer for AI agents",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
