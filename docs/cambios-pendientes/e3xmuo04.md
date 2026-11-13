## Entidades
- `EnvioDeFlujo`: un flujo que la asesora manda desde el chat, con el estado de cada paso (pendiente, enviando, enviado, fallido u omitido), el avance «N de M» y el estado del envío (EN_CURSO, TERMINADO o CON_FALLAS). Reglas en src/lib/flujos/envio-de-flujo.ts. En la parte 1 la tabla existe pero todavía no se llena: el envío de hoy solo escribe la medición `[flujo] medicion` en el log.

## Advertencias de operación
- `envio_de_flujo_enviando`: un paso que queda en «enviando» tras una caída del servidor no se reenvía solo (no se sabe si le llegó a la clienta): pasa a fallido con «no se sabe si salió» y queda con Reintentar para la asesora.
