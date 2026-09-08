/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',

  // Pin the workspace root: there's a stray lockfile above this directory that Turbopack
  // would otherwise try to use for root inference.
  turbopack: {
    root: import.meta.dirname,
  },

  // bcryptjs must run as a real Node module on the server, not be bundled.
  serverExternalPackages: ['bcryptjs'],
};

export default nextConfig;
