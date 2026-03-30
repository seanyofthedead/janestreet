FROM node:20-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY dashboard/package.json dashboard/
COPY trading-core-js/ trading-core-js/
RUN npm ci --workspace=dashboard

FROM node:20-slim AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/dashboard/node_modules ./dashboard/node_modules
COPY package.json package-lock.json ./
COPY dashboard/ dashboard/
COPY tsconfig.base.json ./
WORKDIR /app/dashboard
RUN npx next build

FROM node:20-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/dashboard/.next/standalone ./
COPY --from=builder /app/dashboard/.next/static ./dashboard/.next/static
COPY --from=builder /app/dashboard/public ./dashboard/public 2>/dev/null || true
EXPOSE 3000
CMD ["node", "dashboard/server.js"]
