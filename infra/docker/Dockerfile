FROM node:24.19.0-bookworm-slim AS build
WORKDIR /app
COPY package*.json tsconfig*.json prisma.config.ts playwright.config.ts ./
COPY apps ./apps
COPY packages ./packages
COPY prisma ./prisma
COPY scripts ./scripts
COPY tests ./tests
# Optional trusted corporate CA is mounted only during dependency installation.
RUN --mount=type=secret,id=build_ca_bundle,required=false \
    if [ -f /run/secrets/build_ca_bundle ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/build_ca_bundle; fi; \
    export DATABASE_URL=mysql://build@127.0.0.1:3306/yardhrms; \
    npm ci --cache /tmp/yard-build-npm-cache && rm -rf /tmp/yard-build-npm-cache && npm run db:generate && npm run build

FROM build AS migration
CMD ["npm", "run", "db:migrate"]

FROM build AS production-dependencies
RUN DATABASE_URL=mysql://build@127.0.0.1:3306/yardhrms npm prune --omit=dev

FROM node:24.19.0-bookworm-slim AS server
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates fonts-dejavu-core && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build --chown=node:node /app/package*.json ./
COPY --from=production-dependencies --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
USER node
ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "dist/apps/api/src/server.js"]

FROM nginxinc/nginx-unprivileged:1.28-alpine AS hrms-web
COPY --chown=nginx:nginx infra/deployment/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build --chown=nginx:nginx /app/apps/hrms-web/dist /usr/share/nginx/html

FROM nginxinc/nginx-unprivileged:1.28-alpine AS license-admin-web
COPY --chown=nginx:nginx infra/deployment/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build --chown=nginx:nginx /app/apps/license-admin-web/dist /usr/share/nginx/html
