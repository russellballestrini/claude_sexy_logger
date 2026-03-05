import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ['better-sqlite3'],
  transpilePackages: ['@sexy-logger/core', '@sexy-logger/ui'],
};

export default nextConfig;
