const extraDevOrigins = (process.env.DEV_ALLOWED_ORIGINS ?? "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  allowedDevOrigins: ["localhost", "127.0.0.1", ...extraDevOrigins],
};

export default nextConfig;
