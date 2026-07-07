import path from "node:path";

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@popcharts/api-client", "@popcharts/protocol"],
  turbopack: {
    root: path.join(__dirname, ".."),
  },
};

export default nextConfig;
