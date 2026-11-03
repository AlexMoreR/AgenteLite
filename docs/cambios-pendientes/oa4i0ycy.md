## Entidades
- `CoachRevision`: la revisión diaria del Coach con Opus (desde aizen1) de UNA asesora: una fila por negocio, día (`fecha` AAAA-MM-DD) y asesora, con el resumen, el modelo, cuántos chats leyó y como mucho 1 chat "bien" y 2 "mejorable" (qué pasó, en qué momento se cayó, el mensaje modelo y la causa: asesora, bot, política o cliente sin intención). La guarda Opus con la herramienta del MCP `coach_guardar_revision` (modelo "opus") y `coach_avisar_del_dia` llena `avisadoEn` cuando sale el WhatsApp a la asesora. Es aparte del Coach viejo (`CoachInforme` / `CoachAsesora`), que sigue igual. Reglas en `src/features/coach/revision-opus/reglas.ts`.

## Automatizaciones
- `coach_opus`: el Coach con Opus. Opus (en aizen1) lee los chats del día de cada asesora con `coach_chats_del_dia` (de 00:00 a 22:00 hora de Colombia, los 25 más útiles por asesora) y `coach_ver_chat`, guarda su revisión con `coach_guardar_revision` y avisa con `coach_avisar_del_dia`: a cada asesora un WhatsApp corto por la línea Admin (área de envío "coach", con su propio cupo de una vez por persona y día, aparte del Agente de Ventas) y el resumen del dueño SOLO en la página de Alertas. El único WhatsApp al dueño es el de "día saltado por uso". Los textos los arma el servidor, no la IA. Interruptor `coach-opus:<negocio>` (sin fila, apagado: guardar y avisar responden "apagado").

## Qué no existe hoy
- `coach_opus_audios_api_oficial`: los audios de la API oficial no se transcriben (la base no guarda su texto), así que en `coach_ver_chat` salen como "[audio sin transcribir]" y el Coach con Opus no sabe qué se dijo en ellos.

## Advertencias de operación
- `coach_opus_suscripcion`: el Coach con Opus corre en aizen1 con la suscripción de Claude (modelo Opus) y la gasta. Salta el día si el uso semanal va en 80 % o más (y le avisa al dueño por WhatsApp), corre como máximo 60 minutos y puede coincidir con el Coordinador de las 11 p. m., que usa la misma suscripción.
