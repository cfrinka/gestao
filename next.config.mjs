/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',

  // Pin the workspace root: there's a stray lockfile above this directory that Turbopack
  // would otherwise try to use for root inference.
  turbopack: {
    root: import.meta.dirname,
  },

  // Product photos are camera originals (3000×4000) shown at 48–96 px. The server resizes them
  // once per width and keeps the small copy; a re-uploaded photo gets a new URL and a new copy.
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'storage.googleapis.com' },
      { protocol: 'https', hostname: 'firebasestorage.googleapis.com' },
    ],
    imageSizes: [64, 96, 128, 192, 256, 384],
    // Next 16 only accepts the qualities listed here (default [75]); product-photo.tsx asks
    // for q=70, which would otherwise be refused with a 400.
    qualities: [70, 75],
    formats: ['image/webp'],
    minimumCacheTTL: 60 * 60 * 24 * 30,
  },

  // bcryptjs must run as a real Node module on the server, not be bundled.
  serverExternalPackages: ['bcryptjs'],
};

export default nextConfig;
