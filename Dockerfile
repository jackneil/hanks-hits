# Base stage
# Node 24 is the current LTS line. Keep this major the same as .nvmrc and the
# root package.json "engines" field (platform-config.test.ts checks all three).
FROM node:24.21-alpine AS base
RUN corepack enable && corepack prepare pnpm@9.15.2 --activate

# Builder stage - install deps and build in one stage to avoid pnpm symlink issues
FROM base AS builder
WORKDIR /app

# Copy all package files
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY apps/web/package.json ./apps/web/
COPY packages/db/package.json ./packages/db/

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source code
COPY apps/web ./apps/web
COPY packages/db ./packages/db

# Build the app
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm --filter web build

# Production stage
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Create non-root user
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

# Copy standalone build (includes traced node_modules)
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/static ./apps/web/.next/static

# Copy public assets if they exist
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/public ./apps/web/public

USER nextjs

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["node", "apps/web/server.js"]
