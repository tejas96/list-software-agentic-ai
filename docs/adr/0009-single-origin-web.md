# 0009 · The web server proxies the API and realtime socket

## Decision

The browser only talks to the Next.js server. It rewrites `/api/v1/*` and `/socket.io/` to the API (`API_INTERNAL_URL`, fixed at build time). The API is not exposed publicly.

## Why

- The session cookie never crosses origins, so no third-party-cookie or CORS configuration is needed in any environment.
- One public endpoint to put behind TLS and the corporate reverse proxy.

## Consequences

- `API_INTERNAL_URL` is baked into the web build; the Docker build sets it to `http://api:4000`.
- Socket.IO requires the trailing slash on `/socket.io/`, so the rewrite is explicit and `skipTrailingSlashRedirect` is on.
