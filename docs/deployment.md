# FlowLink production Docker deployment

This document describes the production Docker structure for FlowLink. It intentionally stops at application packaging and container orchestration. Cloud provisioning, DNS, TLS certificate automation, and cost planning are separate deployment steps.

## Architecture

```text
Internet
  |
  v
reverse-proxy:80
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
- `nginx/nginx.conf`: routes `/`, `/api/*`, and `/uploads/*`.
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

Copy the example and fill in real values on the deployment host:

```powershell
Copy-Item .env.production.example .env.production
```

Required production values:

- `FRONTEND_URL`: public HTTPS origin for the deployed site.
- `NEXT_PUBLIC_API_BASE_URL`: public browser-facing API origin. In the Nginx same-origin setup this is usually the same value as `FRONTEND_URL`.
- `DATABASE_URL`: Supabase PostgreSQL connection string.
- `JWT_SECRET_KEY`: at least 32 characters.
- `AI_INTERNAL_API_KEY`: at least 32 characters; must match between backend and backend-ai.
- `DETECTION_MODEL`: defaults to `/app/models/best.pt`.

Optional values:

- `NEXT_PUBLIC_KAKAO_MAP_JS_KEY`: browser-side Kakao map JavaScript key.
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
```

Do not publish these ports directly:

- `3000` frontend
- `8000` backend
- `8001` backend-ai
- `5432` PostgreSQL

TLS termination on `443` should be added when the host domain and certificate strategy are finalized.

## URLs to check

- Frontend through proxy: `http://localhost/`
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
- The backend production config requires secure cookie settings and a valid HTTPS `FRONTEND_URL`.
- For a local HTTP-only smoke test, pages and health checks can be tested, but production auth cookies require HTTPS.
- Supabase PostgreSQL is external. This stack does not run a PostgreSQL container.
- Choose host CPU, RAM, disk, and GPU/CPU inference capacity after measuring the real video workload and model latency. Tiny instances are unlikely to be a safe default for video inference.

## EC2 deployment checklist for the next step

- Choose an instance with enough RAM and CPU for PyTorch, Ultralytics, OpenCV, and the expected video inference workload.
- Install Docker Engine and Docker Compose.
- Put real secrets in `.env.production` on the host only.
- Put the trained model at `models/best.pt` on the host only.
- Configure security groups so only `80` and, after TLS setup, `443` are public.
- Add domain, DNS, HTTPS certificates, and HTTP-to-HTTPS redirect in a separate step.
- Confirm Docker log rotation policy on the host if long-running production logs become large.
