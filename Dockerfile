# Base stage
# Node 24 is the current LTS line. Keep this major the same as .nvmrc and the
# root package.json "engines" field (platform-config.test.ts checks all three).
FROM node:24.21-alpine AS base
RUN corepack enable && corepack prepare pnpm@9.15.2 --activate

# Emulator source stage: the source code of EmulatorJS and its emulator cores.
# The site sends the EmulatorJS files and the cores to each browser, so it
# must also give their source code from the same place (GPL-3.0 section 6(d),
# GPL-2.0 section 3, MPL-2.0 section 3.2). Git does not hold the archives
# (about 137 MB). This stage downloads each archive in manifest.json and
# checks its SHA-256. A failed download or a wrong SHA-256 stops the build,
# so the site never sends the emulator without its source code. The stage
# uses only the manifest and the script, so Docker keeps this layer until one
# of them changes. See apps/web/public/emulator/ejs/README.md.
# When you change the EmulatorJS version, change it here too (3 places).
FROM base AS emulator-sources
# bsdtar reads the 7z release asset. The script needs it only when a mirror
# in manifest.json is down.
RUN apk add --no-cache libarchive-tools
WORKDIR /fetch
COPY apps/web/scripts/emulatorjs-sources.mjs ./emulatorjs-sources.mjs
COPY apps/web/public/emulator/ejs/4.2.3/manifest.json ./manifest.json
RUN node emulatorjs-sources.mjs 4.2.3 --fetch --sources --manifest manifest.json --out /out

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
# The emulator source archives come only from the emulator-sources stage
# (checked downloads). Remove a local copy that the build context can hold.
RUN rm -rf apps/web/public/emulator/ejs/*/source

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

# The checked source archives of EmulatorJS and its cores, next to the files
# that they are the source of (NOTICE.txt links them).
COPY --from=emulator-sources --chown=nextjs:nodejs /out/source ./apps/web/public/emulator/ejs/4.2.3/source

USER nextjs

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["node", "apps/web/server.js"]
