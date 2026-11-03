## Entidades
- `CoachRevision`: la revisión diaria del Coach con Opus (desde aizen1) de UNA asesora: una fila por negocio, día (`fecha` AAAA-MM-DD) y asesora, con el resumen, el modelo, cuántos chats leyó y como mucho 1 chat "bien" y 2 "mejorable" (qué pasó, en qué momento se cayó, el mensaje modelo y la causa: asesora, bot, política o cliente sin intención). `avisadoEn` dice cuándo se le mandó el WhatsApp a la asesora. Es aparte del Coach viejo (`CoachInforme` / `CoachAsesora`), que sigue igual. Reglas en `src/features/coach/revision-opus/reglas.ts`.

## Qué no existe hoy
- `coach_opus_sin_trabajador`: el Coach con Opus solo tiene la tabla y el servicio (parte 1 de 4): todavía no hay herramientas del MCP, pantalla `/cliente/equipo/coach/asesora/<id>` ni trabajador en aizen1, así que no se llena ni manda avisos. Su interruptor es `coach-opus:<negocio>` en AppSetting (sin fila, apagado) y los días que no corrió quedan en `coach-opus-saltado:<negocio>`.
