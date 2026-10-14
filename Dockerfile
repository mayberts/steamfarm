FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:24-alpine
ENV NODE_ENV=production \
    DATA_DIR=/data \
    PORT=8080
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
COPY public ./public
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME ["/data"]
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1
CMD ["node", "dist/index.js"]

LABEL org.opencontainers.image.source="https://github.com/mayberts/steamfarm" \
      org.opencontainers.image.description="Self-hosted Steam idler with a web UI. No ads, no paywalls." \
      org.opencontainers.image.licenses="MIT"
