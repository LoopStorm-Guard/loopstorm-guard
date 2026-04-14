// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Vercel Function entry point for the LoopStorm Guard API.
 *
 * Imports the Hono app from src/app.ts and exports it via Hono's built-in
 * Vercel adapter. All route logic lives in src/app.ts — this file is purely
 * a thin adapter shim.
 *
 * Runtime: nodejs20.x (declared in vercel.json).
 * Region: iad1 (us-east-1 — matches Supabase region).
 *
 * See ADR-015 for the full deployment architecture and migration rationale.
 */

import { handle } from "hono/vercel";
import { app } from "../src/app.js";

// Required by Vercel's Node.js runtime to mark this as a serverless function.
// maxDuration is also set in vercel.json — the lower of the two wins.
export const config = {
  runtime: "nodejs20.x",
};

export default handle(app);
