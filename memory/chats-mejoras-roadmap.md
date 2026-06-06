---
name: chats-mejoras-roadmap
description: Roadmap de mejoras del módulo de chats para equipo de atención al cliente
metadata:
  type: project
---

El módulo de chats (src/components/chats/shared-inbox.tsx + src/app/cliente/chats) se está preparando para que lo usen agentes de atención al cliente ("las chicas") todo el día. Diagnóstico hecho el 2026-06-05.

IMPORTANTE (arquitectura del envío): el envío de texto desde el inbox es **programático, sin navegación, basado en resultado**. El form en shared-inbox.tsx NO usa `action={...}`; el onSubmit hace preventDefault y delega en `handleComposerDraft(message, formData)`, que crea la burbuja optimista (sin etiqueta "enviando" ni atenuado → se ve instantáneo como mensaje enviado) y llama `composer.action(formData)`. `sendManualAgentReplyAction`/`sendUnifiedChatReplyAction` (agent-actions.ts / chats-actions.ts) ya **NO redirigen ni revalidatePath**; devuelven `SendChatReplyResult = {ok:true, suppressOptimistic?} | {ok:false, error}`. El cliente (`finalizeOptimisticSend`) maneja el resultado: ok→deja la burbuja (realtime la reemplaza por el real); ok:false/excepción→marca "error" con botón Reintentar; suppressOptimistic (flujo disparado)→quita la burbuja. Se ELIMINÓ el temporizador de 12s; los errores vienen del resultado, no de un timeout. No reintroducir redirect/revalidate/toast de "Mensaje enviado" ahí (causaban el efecto de recarga). La rama de "flujo" también devuelve resultado (suppressOptimistic), ya no redirige.

MENÚ DE ACCIONES DE MENSAJE (estilo WhatsApp, flecha en la burbuja): componente `MessageActionsMenu` en shared-inbox.tsx con shadcn DropdownMenu. Etapa 1 HECHA: menú con la flecha (aparece en hover via `group/bubble`) + **Copiar** funcional. Pendientes (el usuario quiere TODAS): Responder (citar), Reaccionar (emoji), Reenviar, Fijar, Destacar, Reportar, Eliminar — hoy muestran toast "disponible próximamente". NO existe backend aún para ninguna: requieren acciones + endpoints Evolution (sendReaction, deleteMessage, quoted) + campos nuevos en schema (reaction, isPinned, isStarred) + realtime. Implementar por etapas; CONFIRMAR antes de correr migraciones Prisma sobre la BD del usuario.

Roadmap acordado por fases:
- **Fase 1 (bloqueante):** (1) estado de envío en burbuja enviando/error/reintentar + envío sin recarga ✅ HECHO; (2) modelo de acceso por agente (decidir: ven todo vs. solo asignado — PENDIENTE de decisión del usuario); (3) aviso de presencia multi-agente.
- **Fase 2:** procesar evento `MESSAGES_UPDATE` de Evolution para pintar ✓ entregado / ✓✓ leído (hoy `deliveredAt`/`readAt`/`status` existen en schema pero nunca se actualizan desde webhooks); respuestas rápidas/plantillas; notas internas (`internalNotes` no existe en modelo Conversation).
- **Fase 3:** transferencia con motivo+notificación; cierre con motivo (`closedReason`/`closedBy` no existen); enviar stickers desde inbox; atajos de teclado.

Hallazgos verificados: SÍ existen buenos índices en Message/Conversation (un subagente dijo falsamente que faltaban). El campo `assignedToUserId` ya existe pero el filtro de acceso por agente es opcional en [[chat-conversation-summary]].

Relacionado: el problema de que los stickers entrantes no llegaban era de Evolution API (eventos no entregados), no del código — ver [[evolution-webhook-eventos]].
