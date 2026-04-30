// Next.js configuration.
// Most behavior lives in /admin/settings; this file is intentionally lean.

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  experimental: {
    // Server actions are the API layer; allow body up to 5MB for photo upload.
    serverActions: {
      bodySizeLimit: '5mb',
    },
  },
  // Output standalone bundle so the Dockerfile final stage stays small.
  output: 'standalone',
  serverExternalPackages: ['pg-boss', 'postgres', '@node-rs/argon2'],
};

export default nextConfig;
