import { NextRequest } from "next/server";
import { lanIPv4Addresses } from "@/lib/server/lanAddresses.mjs";

// A static segment outranks the sibling `[...path]` catch-all, so this stays a
// local endpoint and is never proxied to the counseling backend.
export const dynamic = "force-dynamic";

/**
 * Where a phone on the same wifi can reach this machine.
 *
 * The keepsake QR has to encode an address the visitor's phone can open, which
 * is never `localhost` and cannot be baked into the build — the venue hands out
 * a new IP every time. The booth browser asks for this at runtime instead.
 */
export function GET(request: NextRequest) {
  const addresses = lanIPv4Addresses();
  const port = request.nextUrl.port || "3000";
  return Response.json(
    {
      addresses,
      origin: addresses.length ? `http://${addresses[0]}:${port}` : null,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
