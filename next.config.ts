import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Label photos and product videos can be large.
    serverActions: { bodySizeLimit: "50mb" },
  },
};

export default nextConfig;
