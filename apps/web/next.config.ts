import path from 'node:path';
import type { NextConfig } from 'next';

const API = process.env.API_INTERNAL_URL ?? 'http://localhost:4000';

const config: NextConfig = {
  reactStrictMode: true,
  // Self-contained server for the container image; traced from the monorepo root.
  output: 'standalone',
  outputFileTracingRoot: path.resolve(process.cwd(), '../..'),
  transpilePackages: ['@lsa/contracts'],
  // The browser talks to one origin: REST calls and the realtime socket are proxied to the API,
  // so the session cookie never has to cross origins.
  async rewrites() {
    return [
      { source: '/api/v1/:path*', destination: `${API}/api/v1/:path*` },
      { source: '/socket.io/', destination: `${API}/socket.io/` },
    ];
  },
  // Socket.IO requests end in a slash (/socket.io/?EIO=4...); do not redirect them.
  skipTrailingSlashRedirect: true,
  poweredByHeader: false,
};

export default config;
