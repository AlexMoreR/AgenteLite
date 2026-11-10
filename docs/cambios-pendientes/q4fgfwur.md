## Advertencias de operación
- `llamada_en_curso_global`: la llamada de WhatsApp vive en un solo componente para todo el CRM (`LlamadaEnCurso.tsx`, montado en los providers): sigue al cambiar de chat o de pantalla, pero si la asesora recarga o cierra la pestaña se cuelga en WaCalls (sendBeacon). Mientras hay una llamada, los botones de llamar salen apagados con "Ya hay una llamada en curso".
