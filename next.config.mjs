/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',

  // Product photos are camera originals (3000×4000) shown at 48–96 px. The server resizes them
  // once per width and keeps the small copy; a re-uploaded photo gets a new URL and a new copy.
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'storage.googleapis.com' },
      { protocol: 'https', hostname: 'firebasestorage.googleapis.com' },
    ],
    imageSizes: [64, 96, 128, 192, 256, 384],
    formats: ['image/webp'],
    minimumCacheTTL: 60 * 60 * 24 * 30,
  },

  experimental: {
    serverComponentsExternalPackages: ['bcryptjs'],
  },

  transpilePackages: ['firebase', 'undici'],

  webpack: (config, { isServer }) => {
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        net: false,
        tls: false,
        child_process: false,
      };
    }
    return config;
  },
};

export default nextConfig;
