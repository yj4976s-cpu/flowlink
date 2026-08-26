FROM node:22-bookworm-slim AS deps

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-bookworm-slim AS builder

WORKDIR /app

ARG NEXT_PUBLIC_API_BASE_URL
ARG NEXT_PUBLIC_OAUTH_BASE_URL
ARG NEXT_PUBLIC_KAKAO_MAP_JS_KEY
ARG NEXT_PUBLIC_KAKAO_MAP_KEY

ENV NEXT_PUBLIC_API_BASE_URL=${NEXT_PUBLIC_API_BASE_URL}
ENV NEXT_PUBLIC_OAUTH_BASE_URL=${NEXT_PUBLIC_OAUTH_BASE_URL}
ENV NEXT_PUBLIC_KAKAO_MAP_JS_KEY=${NEXT_PUBLIC_KAKAO_MAP_JS_KEY}
ENV NEXT_PUBLIC_KAKAO_MAP_KEY=${NEXT_PUBLIC_KAKAO_MAP_KEY}

COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build
RUN rm -f .next/standalone/.env .next/standalone/.env.*

FROM node:22-bookworm-slim AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=3000

COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
COPY --from=builder --chown=node:node /app/public ./public

USER node

EXPOSE 3000

CMD ["node", "server.js"]
