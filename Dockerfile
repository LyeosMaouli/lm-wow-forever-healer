# syntax=docker/dockerfile:1@sha256:4edf897a3ffa55b89f906fc8cc78afdb3f1834cc9c7083565e611a8a7d5fe99e
ARG NODE_IMAGE=node:24.22.2-alpine3.24@sha256:8a32c8cf649a49915a66e81e7a609223c708d0adabf288ee3f4077d765542f85
FROM ${NODE_IMAGE} AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund
COPY public ./public
COPY scripts/build.mjs ./scripts/build.mjs
RUN npm run build

FROM ${NODE_IMAGE} AS production
ARG APP_VERSION=local
LABEL org.opencontainers.image.revision=${APP_VERSION}
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 LOG_LEVEL=info APP_VERSION=${APP_VERSION}
WORKDIR /app
COPY --chown=node:node package.json package-lock.json server.mjs ./
COPY --chown=node:node scripts/healthcheck.mjs ./scripts/healthcheck.mjs
COPY --from=build --chown=node:node /app/dist ./dist
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD ["node", "scripts/healthcheck.mjs"]
STOPSIGNAL SIGTERM
CMD ["node", "server.mjs"]
