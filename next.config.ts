import type { NextConfig } from "next";
import { execSync } from "child_process";

function getGitShort() {
  try {
    return execSync("git rev-parse --short HEAD", { cwd: process.cwd(), encoding: "utf8" }).trim();
  } catch {
    return "dev";
  }
}

const nextConfig: NextConfig = {
  output: "standalone",
  typescript: {
    // Skip TS checking during build to avoid OOM; run separately if needed
    ignoreBuildErrors: true,
  },
  // Limit workers to avoid OOM on MacBook Air
  // Note: standalone output needs at least some concurrency for file copying
  experimental: {
    workerThreads: false,
  },
  generateBuildId: async () => {
    // Deterministic build ID avoids a Next.js race where static manifests are
    // generated under one random hash but finalization looks for another.
    return `smyth-${getGitShort()}`;
  },
  staticPageGenerationTimeout: 240,
  env: {
    NEXT_PUBLIC_BUILD_VERSION: getGitShort(),
  },
  images: {
    unoptimized: true,
  },
  allowedDevOrigins: ["smythagentapp.greene-solutions.com", "localhost", "127.0.0.1"],
  async rewrites() {
    // Velorn proxy only in development — production builds don't have the dev server
    if (process.env.NODE_ENV !== 'development') {
      return [];
    }
    return [
      {
        source: "/velorn",
        destination: "http://127.0.0.1:5173",
      },
      {
        source: "/velorn/:path*",
        destination: "http://127.0.0.1:5173/:path*",
      },
    ];
  },
};

export default nextConfig;