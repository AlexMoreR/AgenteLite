## Automatizaciones
- `chats_automaticos`: el Supervisor reconoce chats de robots (Bancolombia, Nequi, Daviplata, códigos de verificación, "no responda este mensaje") que ninguna persona ha respondido. No genera avisos por ellos (tampoco "ya pagó / comprobante sin respuesta"), cierra las alertas abiertas que los nombran y oculta el contacto del CRM (`excludedFromCrm`, con nota `metadata.chatAutomatico`). Se deshace desde Contactos y no se vuelve a ocultar.

## Qué no existe hoy
- `chats_automaticos_reglas`: el detector de robots usa una lista fija de nombres y frases en `src/features/supervisor/dominio/chat-automatico.ts`; un robot con un formato nuevo seguirá apareciendo hasta ocultarlo a mano y agregar la regla.
