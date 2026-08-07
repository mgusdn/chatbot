import { lanIPv4Addresses } from "./lib/server/lanAddresses.mjs";

const extraDevOrigins = (process.env.DEV_ALLOWED_ORIGINS ?? "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

// The booth laptop is opened at whatever IP the venue wifi assigned, and the
// dev server rejects cross-origin requests from hosts it does not know. Reading
// the live interfaces keeps that list correct without anyone editing an env
// file; DEV_ALLOWED_ORIGINS stays supported for hosts we cannot detect, such as
// a tunnel domain.
const localOrigins = lanIPv4Addresses();

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  allowedDevOrigins: [...new Set(["localhost", "127.0.0.1", ...localOrigins, ...extraDevOrigins])],
};

export default nextConfig;
