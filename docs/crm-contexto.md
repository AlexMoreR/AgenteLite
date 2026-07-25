# Contexto del CRM de Aizenbot / Magilus

> Documento de referencia para Alexander y su asesor de IA. Describe cómo funciona **hoy** el CRM
> en el código (no cómo debería funcionar). Última actualización: 25-jul-2026.
> Fuente: lectura directa del repositorio `AgenteLite` (Prisma + Next.js App Router).

---

## 1. Modelo de datos real

Base de datos **PostgreSQL** (producción remota, con *drift* — los cambios de esquema se aplican con
`prisma db push`, nunca con `migrate`). Modelos relevantes al CRM (`prisma/schema.prisma`):

### `Contact` — el lead / la ficha
Es la unidad central del CRM. Campos clave:

| Campo | Tipo | Para qué |
|---|---|---|
| `id`, `workspaceId` | | identidad y multi-tenant |
| `name`, `phoneNumber`, `email` | | datos de contacto (`@@unique(workspaceId, phoneNumber)`) |
| `crmStage` | enum `CrmStage` | **etapa del embudo** (ver sección 2). Default `NUEVO` |
| `lostReason` | texto | por qué se perdió — **solo** con `crmStage = PERDIDO`. Es texto (no enum) a propósito: las razones son de negocio y cambian sin migrar la BD. Valores válidos en `crm-config.ts` |
| `notes` | texto | notas manuales |
| `aiSummary` / `aiSummaryAt` | texto/fecha | resumen del lead generado por IA |
| `excludedFromCrm` | bool | si `true`, el contacto no aparece en el CRM |
| `metadata` | JSON | origen del lead (Meta Ads, marketplace…), ciudad, dirección, etc. |
| `avatarUrl` | texto | foto de perfil (se puebla perezosamente) |

**Relaciones:** `ContactTag[]` (etiquetas), `conversations[]` (chats), `messages[]`, `follows[]`
(seguimientos programados), `callAttempts[]` (intentos de llamada — módulo nuevo).

### `CallAttempt` — intento de llamada (módulo de Llamadas, nuevo)
Cada llamada es un **evento con historial**, no un campo único. Campos: `contactId`, `calledByUserId`
(quién llamó), `attemptNumber` (1,2,3… por lead), `result` (lista fija en `crm-config`), `summary`,
`nextContactAt` (próximo contacto), `lostReason` (obligatorio si Perdido), `calledAt` (editable, para
registro retroactivo).

### `Tag` y `ContactTag` — etiquetas
`Tag` = etiqueta del workspace (`name`, `color`, `slug`). `ContactTag` = relación N:N contacto↔etiqueta.
Hay dos etiquetas de ciclo de vida que el sistema asigna solo: **"Nuevo lead"** (slug `nuevo-lead`) y
**"Lead"** (slug `lead`), gestionadas por `syncLeadLifecycleForContact` (`src/lib/contact-default-tags.ts`).

### `Conversation` y `Message` — el chat
`Conversation` (1 por contacto+canal): `status` (`OPEN/PENDING/CLOSED/ARCHIVED`), `assignedToUserId`,
`automationPaused` (IA pausada), `commercialContext` (JSON — etapa comercial que clasifica el bot),
`activeProductContext` (producto activo). `Message`: `direction` (INBOUND/OUTBOUND), `type`, `content`,
`mediaUrl`, `status`, `rawPayload`.

### `User` y `WorkspaceMember` — el equipo
`User` (`role`: ADMIN/CLIENTE/EMPLEADO, `chatSignature`). `WorkspaceMember` liga usuario↔workspace con
`role` (OWNER/…) y `moduleAccess` (qué módulos ve cada empleado). El **dueño** ve todo; un empleado ve
solo los módulos que el dueño le habilita.

### `Follow` y `FollowRule` — seguimientos (ver sección 3)
`FollowRule` = plantilla (cuándo y qué enviar, ante qué disparador). `Follow` = instancia agendada por
contacto (`executeAt`, `status`, locking para el worker).

### `DailyReport` — informe diario
Un registro por workspace y día (`@@unique(workspaceId, reportDate)`): conteos inbound/outbound, nuevos,
ganados/perdidos, montos, `sentiment`, `aiSummary`, y `shareToken` para el link público.

---

## 2. Mapeo de etapas (⚠️ importante)

El **Playbook** habla de temperaturas (Nuevo/Frío/Tibio/Caliente). El **enum real** en la BD tiene otros
nombres. El mapeo vive en `src/features/crm/domain/crm-config.ts` (`CRM_STAGE_META`):

| Playbook (lo que decís) | Enum real (`CrmStage`) | Etiqueta en la UI | Color |
|---|---|---|---|
| **Nuevo** | `NUEVO` | Nuevo | violeta |
| **Frío** | `CALIFICADO` | **Frio** | cian |
| **Tibio** | `PROPUESTA` | **Tibio** | ámbar |
| **Caliente** | `NEGOCIACION` | **Caliente** | rosa |
| **Ganado** | `GANADO` | Ganado | verde |
| **Perdido** | `PERDIDO` | **Descartado** | violeta |

**Consecuencias prácticas:**
- Cuando el Playbook dice "baja a Tibio", en el sistema es `crmStage = PROPUESTA`.
- El orden de avance es `NUEVO → CALIFICADO → PROPUESTA → NEGOCIACION → GANADO`. `PERDIDO` está fuera.
- **Ojo:** en la UI, `PERDIDO` se muestra como **"Descartado"**, no "Perdido".

---

## 3. Automatizaciones que ya existen (y qué disparan)

### 3.1 El agente IA mueve la etapa solo
`src/lib/crm-stage-sync.ts` es el puente entre el embudo del bot y el del CRM. Tras cada mensaje, el
webhook clasifica la "etapa comercial" de la conversación y `syncCrmStageFromCommercialStage()` la
traduce a `crmStage`. **Dos candados:** (1) nunca retrocede (solo avanza en el orden de arriba);
(2) **nunca toca GANADO/PERDIDO** — cerrar una venta es decisión humana, el bot no cierra. Señales que
fuerzan etapa: mostró precio o fotos → `PROPUESTA` (Tibio); detectó objeción → `NEGOCIACION` (Caliente).
Al cambiar, dispara seguimientos y registra "El agente movió la etapa a X".

### 3.2 Seguimientos (Follow / FollowRule) — el motor de WhatsApp automático
Toda la lógica en `src/features/seguimientos/services/follows.ts`.

**Quién crea seguimientos** (`createFollowsFromRulesForSource`): busca reglas activas que coincidan con
un disparador y agenda un `Follow` por cada una. Disparadores:

| Evento | `sourceType` |
|---|---|
| Cambio de etapa CRM (manual o por el agente) | `CRM_STAGE` |
| Se etiqueta un contacto | `TAG` |
| Se dispara un flujo de respuesta rápida | `FLOW` |
| Cambia el producto activo de la conversación | `PRODUCT` |
| Nodo "Seguimiento" del Agente V2 al entrar a una etapa | `AGENT_NODE` |
| Manual desde la UI | `MANUAL` |

**Quién los ejecuta:** un cron externo golpea `POST /api/cron/follows` **cada 60 segundos**;
`executePendingFollows()` reclama los vencidos (`executeAt <= ahora`, con locking) y **envía por
WhatsApp (Evolution)** el mensaje, persistiéndolo en el chat.

**`cancelOnActivity` (default true):** si el contacto tiene actividad (responde, o el asesor le
escribe), se **cancelan** sus seguimientos pendientes. Idea: no perseguir a quien ya está conversando.

> Solo hay proveedor **Evolution (WhatsApp)**. No hay email ni SMS.

### 3.3 Vista "Mi Día" — a quién contactar hoy (ya existe)
`src/features/crm/services/getMiDiaData.ts`, ruta `/cliente/crm/mi-dia`. **Hoy no usa llamadas ni tareas
agendadas** (no había ninguna): deduce la lista del embudo. Entran contactos en `CALIFICADO / PROPUESTA /
NEGOCIACION` (excluye Nuevo y cerrados) sin actividad hace **>2h** y **<30 días**. Prioriza: (1) los que
**esperan respuesta** (el cliente escribió último), (2) etapa más caliente, (3) más abandonado primero.
→ El módulo de Llamadas **complementa** esto con `nextContactAt` real (deja de adivinar por inactividad).

### 3.4 Informe diario del dueño
Cron externo golpea `POST /api/cron/daily-report` cada 60s, pero **solo actúa a las 23:59 hora Bogotá**.
Calcula métricas del día (inbound/outbound, nuevos, ganados/perdidos, montos desde `FinanceTransaction`),
genera un insight con IA (OpenAI → fallback Gemini → heurística) y **envía el informe por WhatsApp** a los
destinatarios configurados, con un link público `/reportes/{token}`.

### 3.5 Tablero del dueño (CRM)
`/cliente/crm/informe` ya tiene: **embudo de conversión** (cuántos leads alcanzan cada etapa y el % de
paso — "¿dónde se caen las ventas?"), **razones de pérdida** (top de `lostReason`), métricas de hoy, y el
**kanban** arrastrable (`/cliente/crm`) que cambia la etapa a mano (con motivo obligatorio al mover a
Descartado).

> **Nota:** los crons son contenedores externos (sidecars). **En local/desarrollo los seguimientos y el
> informe NO corren** salvo que se golpee el endpoint a mano.

---

## 4. Vacíos frente al Playbook de ventas

> Basado en las reglas del Playbook v1.0 que compartiste (clasificación, cadencia, objeciones). Para un
> análisis exhaustivo haría falta el documento completo del Playbook; acá listo lo que **hoy no está
> representado en el sistema**, aparte del módulo de Llamadas que ya construimos (Fase 1).

| Regla del Playbook | ¿Está en el sistema? | Detalle / vacío |
|---|---|---|
| **"No contestó" → WhatsApp automático mismo día** | ❌ Todavía no | Es la **Fase 2** del módulo de Llamadas (se hace con `Follow`). Difiere hasta cerrar el A/B de leads porque toca el envío. |
| **3 intentos + 5 días + cero respuesta → Tibio** | ❌ No automatizado | La regla temporal no la evalúa nada aún. El módulo de Llamadas registra los intentos y fechas (la materia prima), pero falta el job que haga la degradación automática. |
| **"lo piensa" → Tibio inmediato** | ✅ Sí (Fase 1) | Implementado en `CALL_RESULT_STAGE_EFFECT`. |
| **Ganado el día del pago** | ⚠️ Manual | Se marca a mano. No hay enlace entre marcar `GANADO` y un pago real (`FinanceTransaction` existe pero no está atado a cerrar la venta). |
| **Perdido exige motivo** | ✅ Sí | El kanban y el módulo de Llamadas bloquean guardar sin motivo. |
| **"Compró a competencia" → recontacto 60-90 días** | ❌ Todavía no | Fase 2. Requiere agendar un `Follow` diferido o una lista de recontacto. |
| **Manejo de objeciones (guiones)** | ⚠️ Parcial | El bot **detecta** objeción y sube a Caliente, pero no hay guiones/respuestas estructuradas por tipo de objeción (precio, desconfianza, sin plata…). Vive solo en el prompt del agente, no como reglas medibles. |
| **Cadencia de seguimiento del Playbook** (toques día 1/3/5…) | ⚠️ Depende de configuración | El **motor** existe (Follow/FollowRule), pero que la cadencia exacta del Playbook esté cargada como reglas es **configuración**, no código. Habría que verificar qué `FollowRule` están activas hoy. |

### Observaciones extra (útiles para tu asesor de IA)
- **Etiqueta "llamado" genérica:** existía una etiqueta suelta que no dice qué pasó ni cuándo volver.
  El módulo de Llamadas la reemplaza con datos estructurados (resultado + próximo contacto).
- **El informe del dueño (`/cliente/crm/informe`) no es solo-dueño:** cualquier empleado con el módulo
  `crm` habilitado lo ve. Si querés que sea privado del dueño, es un cambio de un candado.
- **`PERDIDO` = "Descartado"** en la UI (posible confusión al leer reportes).
- **Sin email/SMS:** toda automatización de salida es por WhatsApp (Evolution).

---

## Apéndice — archivos clave

| Tema | Archivo |
|---|---|
| Esquema de datos | `prisma/schema.prisma` |
| Etapas, motivos, resultados de llamada | `src/features/crm/domain/crm-config.ts` |
| Puente bot→CRM (mueve etapas) | `src/lib/crm-stage-sync.ts` |
| Motor de seguimientos | `src/features/seguimientos/services/follows.ts` |
| "Mi Día" | `src/features/crm/services/getMiDiaData.ts` |
| Tablero/kanban del dueño | `src/features/crm/components/` |
| Informe diario | `src/features/reportes/services/daily-report.ts` |
| Módulo de Llamadas | `src/features/llamadas/`, `src/app/actions/call-actions.ts` |
