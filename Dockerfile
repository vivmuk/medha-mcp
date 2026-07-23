FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --no-fund
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:22-alpine AS prod-deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev --ignore-scripts --no-fund

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
LABEL org.opencontainers.image.title="Medhā MCP"
LABEL org.opencontainers.image.description="Operator-tuned Venice AI MCP server (fork of @veniceai/mcp-server). Includes /admin SPA for live default-model editing via Postgres-backed mcp_settings overlay."
LABEL org.opencontainers.image.vendor="vivmuk"
LABEL org.opencontainers.image.source="https://github.com/vivmuk/medha-mcp"
LABEL org.opencontainers.image.version="0.6.0-medha"
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY public ./public
# Make SPA readable by the runtime USER (node).
RUN chmod -R a+rx /app/public
COPY package.json ./
EXPOSE 3333
ENV VENICE_MCP_HTTP=1
# Container needs to bind all interfaces so the host port mapping reaches it.
# HTTP startup requires VENICE_MCP_AUTH_TOKEN for this non-loopback bind unless
# VENICE_MCP_ALLOW_UNAUTHENTICATED_HTTP=1 is set behind a trusted proxy.
ENV VENICE_MCP_HOST=0.0.0.0
USER node
CMD ["node", "dist/cli.js", "--http"]
