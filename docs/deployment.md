# FlowLink production Docker deployment

This document describes the production Docker structure for FlowLink, including TLS termination for the production DuckDNS domain. Cloud provisioning and cost planning are separate deployment steps.

## Architecture

```text
Internet
  |
  v
reverse-proxy:80,443
  |-- /              -> frontend:3000
  |-- /api/*         -> backend:8000
  |-- /uploads/*     -> backend:8000
                         |
                         v
                      backend-ai:8001

External services:
  - Supabase PostgreSQL, via DATABASE_URL
  - Optional Supabase Storage, via server-only Supabase service role key
  - Optional Kakao REST API, via server-only KAKAO_REST_API_KEY
```

Only the reverse proxy should be published to the Internet. The frontend, backend, backend-ai, and database ports are internal-only in Docker Compose.

## Files

- `compose.yaml`: base application services, networks, volumes, environment contract, and health checks.
- `compose.prod.yaml`: production restart policy and Nginx reverse proxy.
- `nginx/nginx.conf`: routes `/`, `/api/*`, and `/uploads/*` through one origin. DuckDNS HTTP redirects to HTTPS; LAN HTTP proxies through the same paths for internal demonstrations.
- `certbot/www/.gitkeep`: keeps the host Certbot renewal webroot in Git without committing challenge tokens.
- `frontend/Dockerfile`: multi-stage Next.js standalone image.
- `backend/Dockerfile`: FastAPI application image.
- `backend-ai/Dockerfile`: FastAPI AI inference image with runtime libraries for image/video processing.
- `.env.production.example`: production environment template with empty placeholders for secrets.
- `models/.gitkeep`: keeps the model mount directory in Git without committing model weights.

## Required host files

Create these files on the deployment host:

```text
.env.production
models/best.pt
```

Do not commit either file. `models/best.pt` is mounted into `backend-ai` as read-only at `/app/models/best.pt`.

## Environment setup

Copy the example and fill in real values on the deployment host.

Windows PowerShell:

```powershell
Copy-Item .env.production.example .env.production
```

Linux/Ubuntu:

```bash
cp .env.production.example .env.production
```

Required production values:

- `FRONTEND_URL`: public HTTPS origin for the deployed site.
- `NEXT_PUBLIC_API_BASE_URL`: browser-facing API base. In the Nginx same-origin setup use `/api` so DuckDNS HTTPS and LAN HTTP call the current reverse-proxy origin's `/api/...` routes. Set an absolute API origin only for a deliberately split frontend/backend deployment.
- `DATABASE_URL`: complete Supabase PostgreSQL connection string copied from the Dashboard. The backend accepts `postgresql://` or `postgres://` and selects SQLAlchemy's psycopg 3 dialect automatically; an explicit `postgresql+psycopg://` URL is also accepted. Preserve any query parameters and keep the URI on one line.
- `JWT_SECRET_KEY`: at least 32 characters.
- `AI_INTERNAL_API_KEY`: at least 32 characters; must match between backend and backend-ai.
- `DETECTION_MODEL`: defaults to `/app/models/best.pt`.

Feature-specific and optional integration values:

- `NEXT_PUBLIC_KAKAO_MAP_JS_KEY`: not required to start the containers, but required for a production deployment that uses FlowLink's Kakao map features. Register the actual production domain in Kakao Developers as an allowed JavaScript SDK domain.
- `KAKAO_REST_API_KEY`: server-side Kakao geocoding key.
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_STORAGE_BUCKET`: server-only Supabase Storage integration.
- `ROBOFLOW_API_KEY`, `ROBOFLOW_PROJECT_ID`, `ROBOFLOW_MODEL_VERSION`: optional Roboflow integration values.
- chat provider API keys.

Never put `SUPABASE_SERVICE_ROLE_KEY`, JWT secrets, AI internal keys, or provider API keys in `NEXT_PUBLIC_*` variables.

## Build and run

Validate the merged Compose config:

```powershell
docker compose --env-file .env.production -f compose.yaml -f compose.prod.yaml config
```

Build images:

```powershell
docker compose --env-file .env.production -f compose.yaml -f compose.prod.yaml build
```

Start services:

```powershell
docker compose --env-file .env.production -f compose.yaml -f compose.prod.yaml up -d
```

Check status:

```powershell
docker compose --env-file .env.production -f compose.yaml -f compose.prod.yaml ps
docker compose --env-file .env.production -f compose.yaml -f compose.prod.yaml logs --tail 100
```

Stop services:

```powershell
docker compose --env-file .env.production -f compose.yaml -f compose.prod.yaml down
```

## Volumes and persistence

Local uploaded files are stored in the named Docker volume `flowlink_uploads` and mounted at `/app/uploads` in the backend container.

The AI model directory is mounted from the host:

```yaml
./models:/app/models:ro
```

The model mount is read-only inside the container so inference cannot modify committed or host-managed model files.

## Network exposure

The production Compose override publishes only the reverse proxy:

```yaml
ports:
  - "${HTTP_PORT:-80}:80"
  - "443:443"
```

Do not publish these ports directly:

- `3000` frontend
- `8000` backend
- `8001` backend-ai
- `5432` PostgreSQL

The recommended production/demo URL is `https://flowlink-project.duckdns.org` on port `443`. For academy LAN login demonstrations, use the Nginx reverse proxy at `http://<LAN-IP>/` on port `80`; browser calls still use the same origin through `/api/...` and `/uploads/...`. LAN HTTP login is intended only for private/internal networks. Direct frontend access such as `http://<LAN-IP>:3000` is not a supported authentication demo path because it bypasses the production reverse-proxy entrypoint and can lose the trusted forwarded host/proto context needed for cookie decisions. Before this same-origin LAN support, LAN access should be treated as health-check only.

## HTTPS and certificate renewal

Certbot runs on the EC2 host and manages the certificate under `/etc/letsencrypt`. The production Compose override mounts that host directory read-only at the same path in the Nginx container. The configured certificate files are:

```text
/etc/letsencrypt/live/flowlink-project.duckdns.org/fullchain.pem
/etc/letsencrypt/live/flowlink-project.duckdns.org/privkey.pem
```

The host directory `/home/ubuntu/flowlink/certbot/www` is mounted read-only at `/var/www/certbot` in Nginx. Nginx serves `/.well-known/acme-challenge/` from this directory over HTTP.

### One-time EC2 renewal migration

The certificate was initially issued with Certbot's `standalone` authenticator. Run this migration once after the production stack is running so future renewals do not try to bind host port 80.

First confirm that Certbot reports the expected certificate name:

```bash
sudo certbot certificates
```

With Certbot 5.x, `reconfigure` accepts both `--authenticator webroot` and `--webroot-path`. It performs a staging renewal test and saves the new renewal options only when that test succeeds:

```bash
sudo certbot reconfigure \
  --cert-name flowlink-project.duckdns.org \
  --authenticator webroot \
  --webroot-path /home/ubuntu/flowlink/certbot/www
```

After this succeeds, ordinary `certbot renew` runs reuse the saved `webroot` authenticator and path; do not manually edit `/etc/letsencrypt/renewal/flowlink-project.duckdns.org.conf`. See the [Certbot renewal configuration documentation](https://eff-certbot.readthedocs.io/en/stable/using.html#modifying-the-renewal-configuration-of-existing-certificates).

### Reload Nginx after a successful renewal

Certbot deploy hooks run only after a certificate is successfully issued or renewed. Install a root-owned executable hook so the running Nginx container reloads the updated files from the read-only `/etc/letsencrypt` mount:

```bash
sudo install -d -m 0755 /etc/letsencrypt/renewal-hooks/deploy
sudo tee /etc/letsencrypt/renewal-hooks/deploy/flowlink-nginx-reload >/dev/null <<'EOF'
#!/bin/sh
set -eu
cd /home/ubuntu/flowlink
exec /usr/bin/docker compose --env-file .env.production \
  -f compose.yaml -f compose.prod.yaml \
  exec -T reverse-proxy nginx -s reload
EOF
sudo chmod 0755 /etc/letsencrypt/renewal-hooks/deploy/flowlink-nginx-reload
```

Confirm that Docker is installed at `/usr/bin/docker`; adjust the absolute path in the hook if `command -v docker` reports a different location. Test the hook once against the currently running container:

```bash
sudo /etc/letsencrypt/renewal-hooks/deploy/flowlink-nginx-reload
```

Finally, verify the saved webroot renewal configuration with Let's Encrypt's staging environment:

```bash
sudo certbot renew --dry-run
```

A normal dry run validates renewal but does not execute deploy hooks unless `--run-deploy-hooks` is also supplied, so the manual hook test above is intentional. The host's Certbot systemd timer can then continue running ordinary `certbot renew`; no Nginx stop/start hooks are needed. See the [Certbot deploy hook documentation](https://eff-certbot.readthedocs.io/en/stable/using.html#renewing-certificates).

Do not commit generated challenge tokens, certificates, private keys, renewal configuration, or hook files; all remain host-managed under `/etc/letsencrypt` or the ignored `certbot/www` contents.

## URLs to check

- Production frontend: `https://flowlink-project.duckdns.org/`
- Academy LAN login/demo frontend: `http://<LAN-IP>/`
- Direct frontend container port, if temporarily exposed: `http://<LAN-IP>:3000/` for development checks only; do not use it for authentication demonstrations.
- Reverse proxy health: `http://localhost/healthz`
- Backend health inside Docker network: `http://backend:8000/health`
- Backend AI health inside Docker network: `http://backend-ai:8001/health`

The backend-ai health endpoint does not prove that `best.pt` has completed the first YOLO inference. Model loading can still happen lazily on the first inference request.

The backend API routers already include `/api/...` prefixes, so Nginx forwards `/api/*` without stripping or adding another `/api` segment.

## Health checks

- `frontend`: checks `http://127.0.0.1:3000`.
- `backend`: checks `http://127.0.0.1:8000/health`.
- `backend-ai`: checks `http://127.0.0.1:8001/health`.
- `reverse-proxy`: checks `http://127.0.0.1/healthz`.

## Production notes

- The frontend image bakes `NEXT_PUBLIC_*` variables at build time. Rebuild the frontend image after changing public frontend environment variables.
- The backend production config requires a valid HTTPS `FRONTEND_URL`. Auth cookies are `Secure` for HTTPS requests. For LAN HTTP demonstrations, the backend only relaxes `Secure` when proxy headers identify an internal host such as `localhost`, `127.0.0.1`, `10.0.0.0/8`, `172.16.0.0/12`, or `192.168.0.0/16`.
- Nginx overwrites `X-Forwarded-For` with the direct public client address. The backend trusts proxy headers only from Nginx's fixed `172.30.0.10` address on the private Compose network; keep that address aligned with `FORWARDED_ALLOW_IPS` if the network configuration changes.
- DuckDNS HTTP requests other than `/healthz` and ACME challenges redirect to the production HTTPS origin. LAN HTTP requests are proxied same-origin for internal demonstrations only.
- Production Compose does not publish the frontend `3000` port. Keep LAN login tests on the reverse-proxy URL `http://<LAN-IP>/`, not a direct frontend port.
- Supabase PostgreSQL is external. This stack does not run a PostgreSQL container.
- Choose host CPU, RAM, disk, and GPU/CPU inference capacity after measuring the real video workload and model latency. Tiny instances are unlikely to be a safe default for video inference.

## EC2 deployment checklist for the next step

- Choose an instance with enough RAM and CPU for PyTorch, Ultralytics, OpenCV, and the expected video inference workload.
- Install Docker Engine and Docker Compose.
- Put real secrets in `.env.production` on the host only.
- Put the trained model at `models/best.pt` on the host only.
- Configure the EC2 security group so `80`/`443` are public, `22` is restricted to the administrator's **My IP** CIDR, and `3000`/`8000`/`8001`/`5432` have no public inbound rules.
- Point `flowlink-project.duckdns.org` at the EC2 host and keep the host-managed Certbot certificate renewable through `certbot/www`.
- Confirm Docker log rotation policy on the host if long-running production logs become large.
