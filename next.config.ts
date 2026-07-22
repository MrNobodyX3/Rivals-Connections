import type { NextConfig } from "next";

const [repositoryOwner, repositoryName] = (process.env.GITHUB_REPOSITORY ?? "").split("/");
const isUserSite = repositoryName?.toLowerCase() === `${repositoryOwner}.github.io`.toLowerCase();
const basePath = process.env.GITHUB_ACTIONS && repositoryName && !isUserSite
  ? `/${repositoryName}`
  : "";

const nextConfig: NextConfig = {
  output: "export",
  trailingSlash: true,
  basePath,
  assetPrefix: basePath || undefined,
};

export default nextConfig;
