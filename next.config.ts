import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // No eslint key here!
  typescript: {
    ignoreBuildErrors: true, 
  },
};

export default nextConfig;
