# Plan — Doble gateway WhatsApp: Evolution API + Evolution GO

> **ESTADO (implementado en la rama `feat/dual-gateway-evolution-api-go`, PR #2):**
> Fases 1-5 completas. Verificación automática ✓ (`tsc`, `eslint`, `next build`).
> Falta solo la prueba manual con QR real + deploy (checklist al final).

## Dónde se configuran las conexiones

El admin las configura **una sola vez** en **Admin → Configuracion WhatsApp**: tabla con
**Tipo · URL base · Apikey · Webhook** y botón **"Nueva conexion"** (elige Evolution GO o
Evolution API + URL base + apikey global). Se guardan como JSON en `AppSetting`
(`evolutionGateways`) — **sin migración de BD**.

Los canales **eligen** una de esas conexiones (no se teclea la URL por canal); la apikey
**nunca viaja al navegador**: el cliente manda un `gatewayId` y el servidor resuelve
URL/apikey del catálogo. Si no hay ninguna configurada, el modal de canal dice
**"Falta configurar por un administrador"** y no deja crear.

Retrocompatible: si el catálogo nunca se configuró, se **sintetiza** desde la conexión GO
global existente (evogo sigue igual). Guardar una conexión GO mantiene el global en sync,
que es el fallback de los canales sin `metadata.gateway`.

## Checklist para mañana (tú)

1. **Merge del PR #2** en GitHub y **deploy en Portainer** (build de `main`).
2. **Admin → Configuracion WhatsApp**: verifica que tu conexión **GO** ya aparece en la tabla.
   Agrega con **"Nueva conexion"** tu servidor de **Evolution API** (URL base + apikey).
3. **Canal API nuevo**: Conexión → Nuevo canal → WhatsApp QR Code → elige la conexión
   **Evolution API** de la lista → Crear → **escanea el QR**.
3. **Realtime**: manda un WhatsApp a ese número → debe aparecer **al instante** en Chats (SSE).
   Responde desde el CRM → debe salir. Prueba también que el **agente IA** responda.
4. **Rellenado**: en el detalle del canal → "Sincronizar chats" → por número → confirma que trae
   el historial.
5. **Avatar**: abre un chat y trae la foto de perfil.
6. **Conectar API a "ventas"**: en el detalle de "ventas" → "Conectar este canal a Evolution API"
   → URL + apikey → escanea el QR nuevo → confirma que los **chats viejos siguen ahí**.
7. **No-regresión**: confirma que un canal **evogo** existente sigue funcionando igual.

Si algo falla, el realtime tiene **doble red de seguridad** (WS de evogo + poll de 60s), así que
los mensajes igual llegan aunque el SSE tenga un problema.

---


## Objetivo

Que el CRM soporte **las dos conexiones a la vez**, con **paridad total**:

- Al crear una conexión y elegir **"QR Code"**, poder escoger **Evolution GO** o **Evolution API**.
- Cada canal funciona igual: **realtime, envío, QR/pareo, avatares y sincronización/rellenado**.
- Poder **conectar Evolution API a un canal ya existente** (ej. "ventas") sin perder sus chats.
- Evolution GO se mantiene tal cual (no se rompe nada de lo actual).

## Por qué es un cambio de fondo

Hoy la **URL base + token de Evolution son globales** (un solo valor en `AppSetting`, vía
`getEvolutionSettings()` — `src/lib/system-settings.ts:211`). Todo el sistema asume **un** gateway.
Para tener los dos, la conexión (base URL + token + tipo de gateway) debe resolverse **por-canal**.

Ventaja: gran parte del código de Evolution API **ya existe** (la app se construyó originalmente
sobre Evolution API v2 — provisioning, QR, `findMessages`, webhook). Evolution GO fue lo nuevo. Así
que "activar API" es sobre todo **dejar de forzar el gateway global** y guiar cada llamada al gateway
del canal.

## Diseño

Guardar en `WhatsAppChannel.metadata` (JSON, ya usado para `instanceToken`) la conexión del canal:

```
metadata.gateway = {
  kind: "EVOLUTION_GO" | "EVOLUTION_API",
  baseUrl: string,   // URL del gateway de ESTE canal
  apiKey: string,    // apikey global de ese gateway (para /instance/*)
}
```

Regla de resolución: si el canal trae `metadata.gateway.baseUrl`, se usa esa; si no, cae al global
actual (retrocompatible → los canales evogo existentes siguen igual sin migración de datos).

## Fases

### Fase 1 — Resolución de conexión por-canal (núcleo)

- Nuevo resolver `resolveEvolutionConnection(channelOrInstanceName)` → `{ baseUrl, apiKey, kind, instanceToken, instanceId }`.
  Reutiliza `getStoredEvolutionInstanceAuth` (`evolution.ts:402-421`), que **ya lee la fila del canal**
  por `evolutionInstanceName`; se amplía el `select` para traer `metadata.gateway`.
- Añadir override `{ baseUrl, apiKey }` a los dos helpers HTTP de bajo nivel:
  `evolutionRequest` (`evolution.ts:322-352`) y `evolutionRawRequest` (`:354-380`). Si viene override,
  se usa sobre el global (`${baseUrl}${path}` + header `apikey`).
- Threadear la conexión resuelta por el punto de estrangulamiento `resolveEvolutionInstance`
  (`evolution.ts:423-478`) → de ahí fluye a `evolutionInstanceRequest` (`:514-554`) y a las llamadas
  con "manager headers" (QR/estado). Nota: `resolveEvolutionInstance` debe resolver la base URL del
  canal **antes** de llamar a `/instance/all`.
- Retrocompatible: sin `metadata.gateway`, comportamiento idéntico al actual.

### Fase 2 — Envío, QR, estado, avatares por-canal

Todas estas ya reciben `instanceName`; solo pasan a resolver la conexión del canal:

- Provisioning `provisionEvolutionInstance` (`evolution.ts:1237-1368`) y `createEvolutionChannel`
  (`:1370-1404`): crear la instancia contra la **baseUrl elegida** y guardar `metadata.gateway`.
- QR/estado: `getEvolutionConnectionQr` (`:1122`), `getEvolutionConnectionState` (`:1070`),
  detalle `getWhatsAppBusinessConnectionDetail.ts` (ya bifurca por `provider`).
- Envío `sendEvolutionTextMessage` y borrado/otros en `evolution.ts` → gateway del canal.
- Avatares `fetchEvolutionProfilePictureUrl` (`:2021`) → gateway del canal.

### Fase 3 — Realtime del canal API *(confirmado)*

Cómo funciona hoy (mapeado):

- `src/components/chats/chats-realtime-sync.tsx` abre **un WebSocket nativo al `/ws` GLOBAL de evogo**
  (`:55-67, :1073-1084`). Ese WS **no transporta el mensaje**: es solo un **disparador** ("algo
  cambió") que hace `fetch` a `GET /api/cliente/chats/live` y `/summary` (`:422-457, :504-550`), que
  leen de la **BD**.
- El decoder de payload YA es agnóstico: entiende whatsmeow (`data.Info.*`) **y** Baileys
  (`data.key.remoteJid`) (`:167-221`).
- El **webhook** (`api/webhooks/evolution/route.ts`) persiste MESSAGES_UPSERT de **API y GO igual**
  (`persistEvolutionMessage`, upsert `channelId_externalId`), pero **no empuja nada al navegador**.
- Existe un **polling de 60s** gateway-agnóstico (`src/components/agents/chats-auto-refresh.tsx`,
  `intervalMs=60000`) que dispara los mismos refetch leyendo la BD.

Consecuencia: un canal **API ya recibe mensajes** vía el poll de 60s **sin trabajo de sockets**. Lo
único que falta para paridad "instantánea" es un **disparador** para eventos de API. Opciones:

- **Opción A (MVP, 0 trabajo de realtime):** aceptar el poll de 60s para canales API. Envío/QR/sync
  quedan por-canal (Fases 1-2, 4-5); el realtime del API es "casi en vivo" (≤60s).
- **Opción B (disparo por-gateway):** abrir una **segunda** conexión de realtime al socket propio de
  Evolution API (socket.io/WS, con base URL/token del canal) además del `/ws` de evogo. Reusa el
  decoder existente. Realtime instantáneo para ambos.
- **Opción C (unificar, recomendada a futuro):** que el **servidor empuje** (SSE/socket server) desde
  el webhook tras persistir. Como el webhook ya recibe AMBOS gateways, esto da realtime instantáneo a
  los dos por **un solo camino** y elimina la dependencia del `/ws` de evogo (más robusto, más
  trabajo).

**Decisión tomada: Opción C (SSE unificado).** El servidor empuja a los navegadores desde el
webhook tras persistir, por un `GET /api/cliente/chats/stream` (SSE). Fan-out en proceso
(EventEmitter) → válido porque el deploy es **una sola instancia** (`next start` en un contenedor); si
algún día se escala horizontalmente, se cambia el bus a Redis pub/sub. Esto da realtime instantáneo a
**API y GO** por un solo camino y permite retirar la dependencia del `/ws` de evogo. El poll de 60s se
conserva como red de seguridad.

### Fase 4 — UI: elegir GO o API al crear / conectar API a canal existente

- `NewConnectionChannelModal.tsx` (`:443-469`): en la tarjeta "WhatsApp QR Code" añadir un sub-selector
  **GO / API** (y, para API, URL base + token o un preset). Ubicación natural; el union local ya tiene
  varias variantes (`:22`).
- `createConnectionChannelAction` (`connection-actions.ts:38-133`) / `createEvolutionChannel`: aceptar
  `gatewayKind` + baseUrl/token y persistirlos en `metadata.gateway`.
- **Conectar API a canal existente** ("ventas") — **decisión: API reemplaza a evogo**: acción para
  re-apuntar el canal a una instancia de Evolution API (setear `metadata.gateway.kind = EVOLUTION_API`
  + baseUrl/token) y disparar el QR de API para parear. evogo deja de usarse en ese canal (queda como
  respaldo manual). Los `conversations`/`contacts`/`messages` se conservan (mismo `channelId`).

### Fase 5 — Sincronización / rellenado de chats

- Ya funciona por número (`EvolutionChatSyncDialog` + `evolution-chat-sync.ts`), pero su
  `evolutionSyncRequest` (`:1058`) usa la base URL global. Pasa a usar la conexión del canal
  (Fase 1) → el fill lee `/chat/findMessages` del gateway **API** del canal. Para canales GO el fill
  seguirá limitado (GO no expone `findMessages`), lo cual es esperado.

### Fase 6 — Verificación end-to-end

1. Crear un canal **API** nuevo, escanear QR, confirmar conexión.
2. Recibir un mensaje entrante y verlo **en vivo** en el chat (realtime).
3. Enviar un mensaje saliente desde el CRM.
4. Traer avatar y **rellenar** historial por número.
5. Repetir el flujo "conectar API a 'ventas'" y confirmar que sus chats siguen intactos.
6. Confirmar que un canal **GO** existente sigue funcionando igual (sin regresiones).

## Archivos clave

- `src/lib/evolution.ts` — resolución de conexión + capa HTTP + provisioning/QR/estado/envío/avatares.
- `src/lib/evolution-chat-sync.ts` — sync/fill por-canal.
- `src/app/actions/connection-actions.ts` — crear canal / conectar API a canal existente.
- `src/features/conexion/components/NewConnectionChannelModal.tsx` — selector GO/API.
- `src/features/conexion/services/getWhatsAppBusinessConnectionDetail.ts` — QR/estado por-canal.
- `src/app/api/webhooks/evolution/route.ts` — ingesta (ya gateway-agnóstica) + realtime.
- `prisma/schema.prisma:153-180` — `WhatsAppChannel` (sin migración: se usa `metadata`).

## Riesgos / decisiones abiertas

- **Realtime del canal API** (Fase 3): define el esfuerzo real; se resuelve con el mapeo en curso.
- Un mismo número vinculado a GO **y** API a la vez = dos dispositivos vinculados (WhatsApp permite
  varios). Para "ventas" hay que decidir si API **reemplaza** a GO en ese canal o **coexiste**.
- Mantener el global como fallback evita migrar datos de los canales evogo actuales.

## Fuera de alcance

- Parser del webhook `HistorySync` de evogo (se descartó por poco fiable).
- Migración a la Cloud API oficial (es el destino final, cuando Meta apruebe el Tech Provider).
