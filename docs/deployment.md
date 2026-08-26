# FlowLink dual-entry Docker deployment

FlowLink keeps the latest `develop` application code and adds only the Docker,
Nginx, Certbot, and runtime configuration needed to serve two deployment entry
points:

- LAN HTTP: `http://mbc-sw.iptime.org:3202`
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
- `compose.lan.yaml`: LAN HTTP reverse proxy, no TLS/cert mounts.
- `compose.prod.yaml`: DuckDNS HTTPS reverse proxy with Certbot mounts.
- `nginx/nginx.lan.conf`: HTTP proxy for `mbc-sw.iptime.org`.
- `nginx/nginx.prod.conf`: DuckDNS HTTP redirect, ACME challenge, and HTTPS
  proxy.
- `frontend/Dockerfile`: Next.js standalone production image.
- `backend/Dockerfile`: FastAPI backend image.
- `backend-ai/Dockerfile`: FastAPI AI image with FFmpeg and OpenCV runtime
  libraries for H.264 result videos.
- `.env.lan.example`, `.env.production.example`: environment templates only.
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

## Trusted proxy address

`FORWARDED_ALLOW_IPS` is not the public HTTPS server IP and not the LAN host IP.
It is the Docker-internal address of the trusted Nginx `reverse-proxy`
container that is allowed to supply `X-Forwarded-Proto` and
`X-Forwarded-Host` to the backend.

Both production HTTPS and LAN HTTP use a separate host, but their Compose
network is local to each host. Therefore both stacks can safely use the same
Docker-internal reverse proxy address:

```text
reverse-proxy: 172.30.0.10
backend env:   FORWARDED_ALLOW_IPS=172.30.0.10
```

Do not use a wildcard value for `FORWARDED_ALLOW_IPS`. If `compose.prod.yaml` or
`compose.lan.yaml` stops assigning `reverse-proxy` to `172.30.0.10`, update
`FORWARDED_ALLOW_IPS` to the actual Compose network address before deploying.

## LAN HTTP deployment

Public URL:

```text
http://mbc-sw.iptime.org:3202
```

If the LAN router forwards public port `3202` to host port `8100`, keep:

```env
HTTP_PORT=8100
```

Run:

```bash
docker compose --env-file .env.lan up -d --build
```

LAN Nginx:

- listens on HTTP only
- does not redirect to HTTPS
- does not mount certificates
- routes `/`, `/api/`, and `/uploads/` through one origin
- supports large image/video uploads with `client_max_body_size 128m`
- forwards Range and If-Range headers for MP4 playback

Cookie behavior:

- `AUTH_INSECURE_HTTP_HOSTS=mbc-sw.iptime.org` allows HTTP email/password login
  on the LAN entry point.
- Cookies are host-only, `HttpOnly`, `SameSite=Lax`, `Path=/`.
- `Secure` is omitted only for explicit LAN/internal HTTP hosts.
- Email/password login uses the LAN same-origin `/api` endpoint.
- OAuth must start on the canonical DuckDNS HTTPS origin so the OAuth state
  cookie and callback host match. Set
  `NEXT_PUBLIC_OAUTH_BASE_URL=https://flowlink-project.duckdns.org` for the LAN
  frontend build.

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

If `.env.production` contains `COMPOSE_FILE=compose.yaml:compose.prod.yaml`, the
short form below is equivalent and includes `reverse-proxy` automatically:

```bash
docker compose --env-file .env.production up -d --build
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
- Cookie Domain is not set, so DuckDNS and LAN hosts keep separate host-only
  cookies.

## Important environment values

Production:

```env
COMPOSE_FILE=compose.yaml:compose.prod.yaml
FRONTEND_URL=https://flowlink-project.duckdns.org
NEXT_PUBLIC_API_BASE_URL=/api
NEXT_PUBLIC_OAUTH_BASE_URL=
OAUTH_BACKEND_BASE_URL=https://flowlink-project.duckdns.org
FORWARDED_ALLOW_IPS=172.30.0.10
```

LAN:

```env
COMPOSE_FILE=compose.yaml:compose.lan.yaml
FRONTEND_URL=https://flowlink-project.duckdns.org
NEXT_PUBLIC_API_BASE_URL=/api
NEXT_PUBLIC_OAUTH_BASE_URL=https://flowlink-project.duckdns.org
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
docker compose --env-file .env.lan config
docker compose --env-file .env.production config
docker compose --env-file .env.lan -f compose.yaml -f compose.lan.yaml config --services
docker compose --env-file .env.production -f compose.yaml -f compose.prod.yaml config --services
```

Trusted proxy checks:

```bash
docker compose --env-file .env.production exec reverse-proxy hostname -i
docker compose --env-file .env.production exec backend env | grep FORWARDED_ALLOW_IPS
docker compose --env-file .env.lan exec reverse-proxy hostname -i
docker compose --env-file .env.lan exec backend env | grep FORWARDED_ALLOW_IPS
```

Expected:

- reverse-proxy IP includes `172.30.0.10`
- backend has `FORWARDED_ALLOW_IPS=172.30.0.10`

Runtime status:

```bash
docker compose --env-file .env.production ps
docker compose --env-file .env.production logs -f backend
docker compose --env-file .env.production logs -f backend-ai
docker compose --env-file .env.production logs -f frontend
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

LAN HTTP:

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

The production config uses the webroot challenge path mounted from:

```text
/home/ubuntu/flowlink/certbot/www
```

If the certificate was originally issued with standalone mode, switch renewal to
webroot on the host. The important pieces are:

- webroot: `/home/ubuntu/flowlink/certbot/www`
- Nginx config: `nginx/nginx.prod.conf`
- Compose override: `compose.prod.yaml`
- env file: `.env.production`
- certificate, private key, and Certbot renewal config stay outside Git

Dry-run renewal:

```bash
sudo certbot renew --dry-run
```

After renewal, reload the reverse proxy:

```bash
docker compose --env-file .env.production exec -T reverse-proxy nginx -s reload
```

Typical deploy hook:

```bash
--deploy-hook "cd /home/ubuntu/flowlink && docker compose --env-file .env.production exec -T reverse-proxy nginx -s reload"
```
