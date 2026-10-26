## Advertencias de operación
- `cerebro_escribir`: crear y agregar ya no piden la frase del dueño (solo que la clave sea de la cuenta dueña); reemplazar todo un documento sí la pide. Claude anota cada decisión en el documento único "Decisiones de Magilus", y el servidor le pone la fecha (### AAAA-MM-DD) si falta. Nunca borra; el CRM guarda el antes y el después en CerebroCambio.
- `cerebro_desconectado`: si la última sincronización del cerebro falla o lleva más de 3 horas sin hacerse, se abre una sola alerta IMPORTANTE `CEREBRO:desconectado` en /cliente/crm/supervisor (no se manda WhatsApp ni push). Se cierra sola al sincronizar bien.

## Qué no existe hoy
- `cerebro_deshacer`: no hay botón para deshacer un cambio del cerebro; se hace con el historial de versiones de Drive y el "antes" guardado en CerebroCambio.
