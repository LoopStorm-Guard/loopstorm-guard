// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Root layout for the LoopStorm Guard web UI.
 *
 * Mounts the TRPCProvider (React Query + tRPC) so all client components
 * can use tRPC hooks. The design system tokens are loaded via globals.css.
 *
 * IMPORTANT: This file is licensed AGPL-3.0-only. Do not import it from
 * any MIT-licensed package (ADR-013).
 */

import type { Metadata } from "next";
import { TRPCProvider } from "@/lib/trpc-provider";
import "./globals.css";

export const metadata: Metadata = {
  title: "LoopStorm Guard",
  description: "Runtime enforcement layer for AI agents",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <TRPCProvider>{children}</TRPCProvider>
      </body>
    </html>
  );
}
