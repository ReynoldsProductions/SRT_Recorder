# c2c-console — no npm dependencies; Node built-ins only.
# Base pinned by digest (node:24-alpine = v24.22.3 at build time 2026-11-24).
FROM node@sha256:116b800c3754b440ee0aa3ed2f20f5bf3d99a554bfd9adeea09ea8017f6e85f5
WORKDIR /app
COPY package.json ./
COPY src ./src
COPY public ./public
ENV NODE_ENV=production PORT=3020
USER node
EXPOSE 3020
HEALTHCHECK --interval=30s --timeout=3s --retries=3 CMD wget -qO- http://127.0.0.1:3020/healthz >/dev/null || exit 1
CMD ["node", "src/server.js"]
