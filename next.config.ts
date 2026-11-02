import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // ffmpeg-static ships a binary; keep it out of the bundle but include it in the render function.
  serverExternalPackages: ["ffmpeg-static"],
  outputFileTracingIncludes: {
    "/api/scans/[id]/render": ["./node_modules/ffmpeg-static/ffmpeg", "./assets/fonts/**"],
  },
  experimental: {
    // Label photos and product videos can be large.
    serverActions: { bodySizeLimit: "50mb" },
  },
};

export default nextConfig;
