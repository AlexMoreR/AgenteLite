# syntax=docker/dockerfile:1.7
FROM node:20-alpine AS deps
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY package*.json ./
RUN --mount=type=cache,target=/root/.npm npm ci

FROM node:20-alpine AS builder
WORKDIR /app
ARG DEPLOYMENT_ID
ARG NEXT_SERVER_ACTIONS_ENCRYPTION_KEY
ENV DEPLOYMENT_ID=${DEPLOYMENT_ID}
# La misma version, pero visible desde el navegador: con esto la app se da cuenta sola de que
# quedo corriendo una version vieja (ver /api/version y AvisoVersionNueva).
ENV NEXT_PUBLIC_DEPLOYMENT_ID=${DEPLOYMENT_ID}
ENV NEXT_SERVER_ACTIONS_ENCRYPTION_KEY=${NEXT_SERVER_ACTIONS_ENCRYPTION_KEY}
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate
RUN --mount=type=cache,target=/app/.next/cache npm run build

FROM node:20-alpine AS runner
WORKDIR /app
# ffmpeg convierte cada audio del chat a un formato que suene en todos los navegadores
# (ver src/lib/audio-para-escuchar.ts). Si faltara, los audios se guardan tal cual llegan.
RUN apk add --no-cache ffmpeg
# Respaldo nocturno de la base (servicio aizenbot_respaldo, docker/respaldo/respaldo.sh): pg_dump y
# pg_restore, rclone para subir a Google Drive y curl para el correo de aviso. pg_dump tiene que ser
# de la misma version que el Postgres del servidor o mas nueva: se instala la mas nueva que haya
# (un pg_dump nuevo sabe copiar bases de versiones anteriores). Se elige por lo que el repositorio de
# Alpine ofrece, no por un error al instalar. Si no se puede instalar, falla la construccion y no se
# despliega nada.
RUN PG=postgresql17-client \
  && if apk --no-cache search -x postgresql18-client | grep -q '^postgresql18-client'; then PG=postgresql18-client; fi \
  && apk add --no-cache "$PG" rclone curl \
  && pg_dump --version && rclone version && curl --version
ENV NODE_ENV=production
ENV PORT=3000
ENV PRISMA_AUTO_RESOLVE_FAILED_OFFICIAL_API_MIGRATION=false
ENV NEXT_TELEMETRY_DISABLED=1

COPY package*.json ./
COPY prisma ./prisma
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/next.config.ts ./next.config.ts
COPY --from=builder /app/prisma.config.ts ./prisma.config.ts
# Altavoz de realtime (WebSocket). Viaja en la MISMA imagen y se corre como un servicio
# aparte con `node realtime-server.js` (ver stack). JS plano: arranca sin compilar.
COPY --from=builder /app/realtime-server.js ./realtime-server.js
COPY docker/entrypoint.sh ./docker/entrypoint.sh
# Lo que el codigo no sabe del sistema (negocio, decisiones, lo que falta). Lo lee la herramienta
# `que_es_esta_aplicacion` del MCP en tiempo real; sin esta linea solo saldria la parte en vivo.
COPY docs/que-es-esta-aplicacion.md ./docs/que-es-esta-aplicacion.md
# Solo los dos guiones: lo de aizen1 no hace falta en la imagen.
COPY docker/respaldo/respaldo.sh docker/respaldo/restaurar-prueba.sh ./docker/respaldo/
RUN chmod +x ./docker/entrypoint.sh

EXPOSE 3000

CMD ["sh", "./docker/entrypoint.sh"]
