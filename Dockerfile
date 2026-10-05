FROM node:24-alpine AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
# `next build` on this app (60+ routes) can exceed Node's default ~2GB heap on
# constrained CI runners; raise it rather than fail silently with exit code 1.
ENV NODE_OPTIONS=--max-old-space-size=4096
COPY package.json package-lock.json .npmrc ./
RUN npm ci
COPY . .
RUN npm run build && npm run build:db

FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
RUN addgroup -S nodejs -g 1001 && adduser -S nextjs -u 1001 -G nodejs && mkdir -p /app/storage && chown nextjs:nodejs /app/storage
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/dist/db-setup.cjs /app/dist/db-seed.cjs ./
COPY --from=builder --chown=nextjs:nodejs /app/scripts/start-with-database.mjs ./
USER nextjs
EXPOSE 3000
CMD ["node","start-with-database.mjs"]

