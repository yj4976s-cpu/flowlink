# FlowLink dual-entry Docker deployment

FlowLink keeps the latest `develop` application code and adds only the Docker,
Nginx, Certbot, and runtime configuration needed to serve two deployment entry
points:

- Academy HTTP: `http://mbc-sw.iptime.org:3202`
- Production HTTPS: `https://flowlink-project.duckdns.org/`

The two URLs are intentionally separate. Do not rewrite one entry point into the
other except for the DuckDNS HTTP-to-HTTPS redirect described below.

## Architecture

```text
Browser
  |
  v
Nginx reverse-proxy
  |-- /           -> frontend:3000
  |-- /api/*      -> backend:8000
  |-- /uploads/*  -> backend:8000
                       |
                       v
                    backend-ai:8001
```

Only Nginx publishes host ports. `frontend`, `backend`, and `backend-ai` use
Docker `expose` only and must not be opened directly to browsers.

## Files

- `compose.yaml`: common services, networks, volumes, environment contract, and
  health checks.
- `compose.academy.yaml`: academy HTTP reverse proxy, no TLS/cert mounts.
- `compose.prod.yaml`: DuckDNS HTTPS reverse proxy with Certbot mounts.
- `nginx/nginx.academy.conf`: HTTP proxy for `mbc-sw.iptime.org`.
- `nginx/nginx.prod.conf`: DuckDNS HTTP redirect, ACME challenge, and HTTPS
  proxy.
- `frontend/Dockerfile`: Next.js standalone production image.
- `backend/Dockerfile`: FastAPI backend image.
- `backend-ai/Dockerfile`: FastAPI AI image with FFmpeg and OpenCV runtime
  libraries for H.264 result videos.
- `.env.academy.example`, `.env.production.example`: environment templates only.
- `models/.gitkeep`: keeps the host model mount directory without committing
  model weights.
- `certbot/www/.gitkeep`: keeps the ACME webroot without committing challenge
  tokens.

Do not commit real `.env` files, certificates, private keys, uploads, logs, or
model files such as `best.pt`.

## Common runtime rules

- Browser traffic enters through Nginx only.
- Browser API calls use same-origin `/api`.
- Browser uploads/media calls use same-origin `/uploads`.
- `AI_SERVICE_URL=http://backend-ai:8001` is internal to Docker.
- Backend and backend-ai share `AI_INTERNAL_API_KEY`.
- Supabase PostgreSQL remains external through `DATABASE_URL`; this stack does
  not start a PostgreSQL container.
- `models/best.pt` is mounted read-only into backend-ai at `/app/models/best.pt`.

## Academy HTTP deployment

Public URL:

```text
http://mbc-sw.iptime.org:3202
```

If the academy router forwards public port `3202` to host port `8100`, keep:

```env
HTTP_PORT=8100
```

Run:

```bash
docker compose \
  --env-file .env.academy \
  -f compose.yaml \
  -f compose.academy.yaml \
  up -d --build
```

Academy Nginx:

- listens on HTTP only
- does not redirect to HTTPS
- does not mount certificates
- routes `/`, `/api/`, and `/uploads/` through one origin
- supports large image/video uploads with `client_max_body_size 128m`
- forwards Range and If-Range headers for MP4 playback

Cookie behavior:

- `AUTH_INSECURE_HTTP_HOSTS=mbc-sw.iptime.org` allows HTTP email/password login
  on the academy entry point.
- Cookies are host-only, `HttpOnly`, `SameSite=Lax`, `Path=/`.
- `Secure` is omitted only for explicit academy/internal HTTP hosts.
- OAuth callbacks remain on the canonical DuckDNS HTTPS origin unless a separate
  OAuth environment is deliberately configured.

## Production HTTPS deployment

Public URL:

```text
https://flowlink-project.duckdns.org/
```

Run:

```bash
docker compose \
  --env-file .env.production \
  -f compose.yaml \
  -f compose.prod.yaml \
  up -d --build
```

Production Nginx:

- publishes `80` and `443`
- redirects DuckDNS HTTP requests to HTTPS except ACME challenge and health
- serves `/.well-known/acme-challenge/` from `certbot/www`
- mounts `/etc/letsencrypt` read-only
- routes `/`, `/api/`, and `/uploads/` through one origin
- forwards Range and If-Range headers for MP4 playback

Certificate paths:

```text
/etc/letsencrypt/live/flowlink-project.duckdns.org/fullchain.pem
/etc/letsencrypt/live/flowlink-project.duckdns.org/privkey.pem
```

Cookie behavior:

- HTTPS requests always set `Secure`.
- External HTTP requests still keep `Secure=true` and are redirected by Nginx.
- Cookie Domain is not set, so DuckDNS and academy hosts keep separate host-only
  cookies.

## Important environment values

Production:

```env
FRONTEND_URL=https://flowlink-project.duckdns.org
NEXT_PUBLIC_API_BASE_URL=/api
OAUTH_BACKEND_BASE_URL=https://flowlink-project.duckdns.org
FORWARDED_ALLOW_IPS=172.30.0.10
```

Academy:

```env
FRONTEND_URL=https://flowlink-project.duckdns.org
NEXT_PUBLIC_API_BASE_URL=/api
OAUTH_BACKEND_BASE_URL=https://flowlink-project.duckdns.org
ALLOWED_FRONTEND_ORIGINS=http://mbc-sw.iptime.org:3202,https://flowlink-project.duckdns.org
AUTH_INSECURE_HTTP_HOSTS=mbc-sw.iptime.org
FORWARDED_ALLOW_IPS=172.30.0.10
HTTP_PORT=8100
```

`NEXT_PUBLIC_*` values are baked into the frontend image at build time. Rebuild
the frontend after changing them.

## Validation commands

Compose config:

```bash
docker compose --env-file .env.academy -f compose.yaml -f compose.academy.yaml config
docker compose --env-file .env.production -f compose.yaml -f compose.prod.yaml config
```

Runtime status:

```bash
docker compose --env-file .env.production -f compose.yaml -f compose.prod.yaml ps
docker compose --env-file .env.production -f compose.yaml -f compose.prod.yaml logs -f backend
docker compose --env-file .env.production -f compose.yaml -f compose.prod.yaml logs -f backend-ai
docker compose --env-file .env.production -f compose.yaml -f compose.prod.yaml logs -f frontend
```

MP4 Range checks:

```bash
curl -I https://flowlink-project.duckdns.org/uploads/<actual-result>.mp4
curl -I -H "Range: bytes=0-1023" https://flowlink-project.duckdns.org/uploads/<actual-result>.mp4
curl -I http://mbc-sw.iptime.org:3202/uploads/<actual-result>.mp4
curl -I -H "Range: bytes=0-1023" http://mbc-sw.iptime.org:3202/uploads/<actual-result>.mp4
```

Expected:

- normal request: `200`
- range request: `206`
- `Content-Range` exists
- `Content-Type` is video-compatible
- Chrome/Edge can play `original_media_url` and `result_media_url`

## Manual smoke checklist

Academy HTTP:

- open `http://mbc-sw.iptime.org:3202`
- register
- login
- `/api/auth/me`
- logout
- admin login
- image detection
- video detection and `result.mp4` playback
- cookie has no `Secure`

Production HTTPS:

- open `https://flowlink-project.duckdns.org`
- HTTP redirects to HTTPS
- register
- login
- `/api/auth/me`
- logout
- OAuth callback
- image detection
- video detection and `result.mp4` playback
- cookie has `Secure`
- TLS certificate is valid

## Certbot renewal

Certbot is host-managed. Nginx only mounts certificate files and the challenge
webroot. Do not copy certificates into Docker images.

After renewal, reload the reverse proxy:

```bash
docker compose --env-file .env.production -f compose.yaml -f compose.prod.yaml exec -T reverse-proxy nginx -s reload
```
