import type { NextConfig } from "next";

/**
 * Nothing that depends on who is asking may sit in a shared cache.
 *
 * proxy.ts sets the same header on the same routes and explains why at length.
 * This repeats it declaratively because the two run in different places: a
 * deployment that puts its CDN *in front* of proxy.ts (the Next.js CDN caching
 * guide calls this out) never sees the proxy's decision, but it does see this.
 * Either layer alone closes the hole; both together survive a move between
 * hosts.
 *
 * `send-payload.js` fills in `Cache-Control` only when it is not already set —
 * "to allow users to customize it via next.config" — so these win over the
 * `s-maxage=31536000` a prerendered page would otherwise be served with.
 *
 * /api is deliberately absent: route handlers are dynamic and already answer
 * with `private, no-cache, no-store`, and the two streaming interview endpoints
 * set their own headers. proxy.ts still seals them per-request.
 */
const SESSION_DEPENDENT_PATHS = [
  '/auth',
  '/dashboard',
  '/projects',
  '/sessions',
  '/interview',
  '/credits',
  '/settings',
  '/profile',
  '/admin',
];

const NO_STORE = 'private, no-store, max-age=0, must-revalidate';

const noStoreHeaders = [
  { key: 'Cache-Control', value: NO_STORE },
  { key: 'CDN-Cache-Control', value: NO_STORE },
  { key: 'Vercel-CDN-Cache-Control', value: NO_STORE },
  { key: 'Vary', value: 'Cookie' },
];

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**',
      },
      {
        protocol: 'http',
        hostname: '**',
      },
    ],
  },
  async headers() {
    return SESSION_DEPENDENT_PATHS.flatMap((path) => [
      { source: path, headers: noStoreHeaders },
      { source: `${path}/:path*`, headers: noStoreHeaders },
    ]);
  },
};

export default nextConfig;
