/** @type {import('next').NextConfig} */
const nextConfig = {
  // Workspace packages ship TypeScript source, not a build step.
  transpilePackages: ["@firstrun/db", "@firstrun/schema", "@firstrun/identity"],
  eslint: { ignoreDuringBuilds: true },

  // The workspace packages write ESM-correct relative imports ending in `.js`
  // that point at `.ts` files, which Bun and tsc both resolve and webpack does
  // not. Teaching the bundler the same mapping is cheaper than making every
  // other consumer of these packages use extensionless imports.
  webpack: (config) => {
    config.resolve.extensionAlias = {
      ".js": [".ts", ".tsx", ".js"],
    };
    return config;
  },
};

export default nextConfig;
