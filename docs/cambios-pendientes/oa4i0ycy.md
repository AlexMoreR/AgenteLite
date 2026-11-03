## Entidades
- `CoachRevision`: la revisión diaria del Coach con Opus de UNA asesora (una fila por negocio, día y asesora): resumen, máximo 1 chat "bien" y 2 "mejorable" con qué pasó, dónde se cayó, el mensaje modelo y la causa (asesora, bot, politica, cliente_sin_intencion), cuántos chats leyó y `avisadoEn` (cuándo se le mandó el WhatsApp). La escribe Opus desde aizen1 con la herramienta del MCP `coach_guardar_revision`; las reglas están en `src/features/coach/revision-opus/reglas.ts`.

## Automatizaciones
- `coach_opus`: cada noche, desde aizen1, Opus lee con el MCP del CRM los chats de 00:00 a 22:00 (hora de Colombia) de cada asesora (`coach_chats_del_dia`, máximo 25 por asesora, y `coach_ver_chat`), guarda una revisión por asesora (`coach_guardar_revision`) y llama a `coach_avisar_del_dia`: el CRM arma los textos (sin texto libre de la IA) y le manda a cada asesora un WhatsApp corto con el link a su revisión por la línea Admin, con el área de envío `coach` (solo números del equipo, una vez por persona y día, con su propio cupo para no gastar el del Agente de Ventas). El resumen del dueño va SOLO a la página de Alertas; el único WhatsApp del dueño es el aviso de "día saltado por uso". Interruptor `AppSetting` `coach-opus:<negocio>` = 1; apagado, guardar y avisar responden "apagado" y no hacen nada. Nunca le escribe a un cliente.

## Qué no existe hoy
- `coach_opus_audios_api_oficial`: la API oficial no guarda la transcripción de los audios: en `coach_ver_chat` esos audios salen como "[audio sin transcribir]" y el Coach con Opus no sabe qué dijeron.

## Advertencias de operación
- `coach_opus_suscripcion`: el Coach con Opus gasta la suscripción de Claude de aizen1 (modelo Opus). Si el uso semanal va en 80 % o más, salta el día (queda anotado y le llega al dueño el WhatsApp "día saltado por uso"); cada corrida dura como máximo 60 minutos y puede coincidir con el Coordinador de las 11 p. m., que usa la misma suscripción.
