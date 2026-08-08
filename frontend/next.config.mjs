import { lanIPv4Addresses } from "./lib/server/lanAddresses.mjs";

const extraDevOrigins = (process.env.DEV_ALLOWED_ORIGINS ?? "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

// Next matches these per dot-separated segment, so a single "*" stands in for
// one octet of an IPv4 address. Covering the RFC1918 ranges means the venue can
// reassign the laptop's address — or the operator can switch networks — without
// the dev server starting to block its own pages.
//
// This has to be static because next.config is read once at startup: the live
// interface scan below cannot see an address the machine picks up later, which
// is exactly how a keepsake page ends up served but unable to hydrate.
const PRIVATE_LAN_PATTERNS = ["192.168.*.*", "10.*.*.*", "172.*.*.*"];

// Some venue routers hand out a public address directly, which no private-range
// pattern can cover, so still read the interfaces that exist at startup.
// DEV_ALLOWED_ORIGINS stays supported for hosts neither approach finds, such as
// a tunnel domain.
const localOrigins = lanIPv4Addresses();

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  allowedDevOrigins: [
    ...new Set([
      "localhost",
      "127.0.0.1",
      ...PRIVATE_LAN_PATTERNS,
      ...localOrigins,
      ...extraDevOrigins,
    ]),
  ],
};

export default nextConfig;
