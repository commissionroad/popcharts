import { NextResponse } from "next/server";

// Liveness target for the local dev stack's recurring `app-ready` probe
// (local-dev.control-plane.yaml). The probe fires every few seconds for the
// lifetime of the stack, so this route must stay dependency-free and never
// trigger page rendering: probing an SSR page instead grew the dev server to
// 35GB over a day of uptime.
export function GET() {
  return NextResponse.json({ ok: true });
}
