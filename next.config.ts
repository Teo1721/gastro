import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* Only keep modern options here */
  typescript: {
    ignoreBuildErrors: true,
  }
};

export default nextConfig;
