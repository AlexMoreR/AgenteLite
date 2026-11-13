## Entidades
- `EnvioDeFlujo`: un envío de un flujo desde el chat, paso por paso: conversación, flujo, asesora, la lista de pasos con su estado (pendiente, enviando, enviado, fallido u omitido), el avance «N de M» y el estado (EN_CURSO, TERMINADO o CON_FALLAS). Por ahora solo existe la tabla: el envío de hoy todavía no la usa (parte 1 de 4).

## Advertencias de operación
- `envio_de_flujo_paso_a_medias`: si el servidor se cae mientras un paso está «enviando», ese paso NO se reenvía solo al volver (no se sabe si le llegó a la clienta): queda como fallido con «no se sabe si salió» y la asesora decide con Reintentar. El log `[flujo] medicion` dice cuántos milisegundos tardó cada paso y el total.
