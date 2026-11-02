import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["youtubei.js", "bgutils-js", "jsdom"],
  poweredByHeader: false,
};

export default nextConfig;
