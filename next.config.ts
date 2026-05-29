import type { NextConfig } from "next";

function normalizeDeploymentId(value: string | undefined): string {
  return value?.trim().replace(/[^a-zA-Z0-9_-]/g, "") ?? "";
}

const deploymentId = normalizeDeploymentId(
  process.env.DEPLOYMENT_ID ||
    process.env.NEXT_DEPLOYMENT_ID ||
    process.env.GITHUB_SHA ||
    process.env.VERCEL_GIT_COMMIT_SHA,
);

const nextConfig: NextConfig = {
  // Use a stable deployment identifier when the build pipeline provides one.
  // This helps Next detect version skew during rolling deploys and prevents
  // stale Server Action payloads from trying to hit a newer build.
  ...(deploymentId
    ? {
        deploymentId,
        generateBuildId: async () => deploymentId,
      }
    : {}),
};

export default nextConfig;
