import type { NextConfig } from 'next';

const API = process.env.API_INTERNAL_URL ?? 'http://localhost:4000';

const config: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@lsa/contracts'],
  // The browser talks to one origin; REST calls are proxied to the API.
  async rewrites() {
    return [{ source: '/api/v1/:path*', destination: `${API}/api/v1/:path*` }];
  },
  poweredByHeader: false,
};

export default config;
