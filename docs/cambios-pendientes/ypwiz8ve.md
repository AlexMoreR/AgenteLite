## Qué no existe hoy
- `chats_automaticos_supervisor`: el Supervisor solo reconoce robots con reglas fijas (nombre de banco o servicio, o mensajes con forma de notificación y ninguna respuesta de una persona). Un robot con un formato nuevo seguirá apareciendo hasta ocultarlo a mano desde Contactos y agregar la regla en `chat-automatico.ts`.

## Advertencias de operación
- `supervisor_oculta_robots`: el Supervisor marca como oculto del CRM (`excludedFromCrm`) a los contactos que detecta como robot y deja `metadata.chatAutomatico` (motivo y fecha). Se deshace desde Contactos con el botón de mostrar; con esa nota el Supervisor no lo vuelve a ocultar.
