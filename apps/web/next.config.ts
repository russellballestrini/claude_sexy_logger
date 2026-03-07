import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ['better-sqlite3'],
  transpilePackages: ['@unturf/unfirehose', '@unturf/unfirehose-ui'],
};

export default nextConfig;
