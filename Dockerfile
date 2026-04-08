FROM node:20-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci

FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV PRISMA_AUTO_RESOLVE_FAILED_OFFICIAL_API_MIGRATION=false

COPY package*.json ./
COPY prisma ./prisma
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/next.config.ts ./next.config.ts
COPY --from=builder /app/prisma.config.ts ./prisma.config.ts

EXPOSE 3000

CMD ["sh", "-ec", "if [ \"$PRISMA_AUTO_RESOLVE_FAILED_OFFICIAL_API_MIGRATION\" = \"true\" ]; then echo 'Running Prisma migrate deploy with auto-recovery for failed official API base migration...'; DEPLOY_STATUS=0; DEPLOY_OUTPUT=\"$(npx prisma migrate deploy 2>&1)\" || DEPLOY_STATUS=$?; echo \"$DEPLOY_OUTPUT\"; if [ \"$DEPLOY_STATUS\" -ne 0 ]; then if echo \"$DEPLOY_OUTPUT\" | grep -q 'P3009' && echo \"$DEPLOY_OUTPUT\" | grep -q '20260402130000_add_official_api_module_base'; then echo 'Detected failed migration 20260402130000_add_official_api_module_base. Resolving as applied and retrying deploy...'; npx prisma migrate resolve --applied 20260402130000_add_official_api_module_base; npx prisma migrate deploy; else exit \"$DEPLOY_STATUS\"; fi; fi; else npx prisma migrate deploy; fi; exec npm run start"]
