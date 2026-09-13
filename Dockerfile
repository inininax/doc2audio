# syntax=docker/dockerfile:1
FROM node:24-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/package.json
RUN npm ci --no-audit --no-fund

COPY apps/web/ apps/web/
COPY scripts/prepare-web-runtime.mjs scripts/build-web-cache.mjs scripts/

ARG DOC2AUDIO_BASE=/
ARG DOC2AUDIO_SITE_URL=
RUN node -e 'const base = process.env.DOC2AUDIO_BASE; if (!/^\/(?:[A-Za-z0-9_-]+\/)*$/.test(base) || base.startsWith("/healthz/")) throw new Error("DOC2AUDIO_BASE must be / or an ASCII directory path ending in /; /healthz/ is reserved.")' \
    && npm run build \
    && mkdir -p "/static${DOC2AUDIO_BASE}" \
    && cp -R apps/web/dist/. "/static${DOC2AUDIO_BASE}"

FROM nginxinc/nginx-unprivileged:stable-alpine AS runtime
USER root
RUN rm -rf /usr/share/nginx/html/*
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /static/ /usr/share/nginx/html/
USER 101:101

EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1
