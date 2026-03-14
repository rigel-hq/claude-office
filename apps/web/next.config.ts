import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['@rigelhq/shared'],
  webpack: (config) => {
    // Resolve .js imports to .ts files in the shared package
    // (shared uses .js extensions for Node.js ESM compat)
    config.resolve.extensionAlias = {
      '.js': ['.ts', '.tsx', '.js'],
    };
    return config;
  },
};

export default nextConfig;
