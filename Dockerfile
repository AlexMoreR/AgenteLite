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

CMD ["sh", "-c", "if [ \"$PRISMA_AUTO_RESOLVE_FAILED_OFFICIAL_API_MIGRATION\" = \"true\" ]; then if npx prisma migrate status 2>&1 | grep -q 'Following migration have failed:'; then echo 'Detected failed Prisma migration. Resolving 20260402130000_add_official_api_module_base as applied...'; npx prisma migrate resolve --applied 20260402130000_add_official_api_module_base; fi; fi; npx prisma migrate deploy && npm run start"]
