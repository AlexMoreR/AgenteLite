## Advertencias de operación
- `alertas_cierre_solo`: las alertas abiertas de una tarjeta se cierran solas (quedan RESUELTA con "Resuelta sola: <motivo> (<d-mmm HH:mm>)" al final del detalle). Aprobar la tarjeta cierra `auto:necesita`, `auto:trabado` y `coord:necesita`; editar su detalle cierra solo la `coord:necesita` (la respuesta del dueño); pasarla a HECHO o FALLIDO, o borrarla, cierra todas las de la tarjeta (también `auto:equipo`) menos `terminada:<id>`. Vale igual por el MCP y por los botones de la pantalla. Si cerrar la alerta falla, la acción sobre la tarjeta sale bien igual y queda una línea "[alertas] no se pudieron cerrar…" en el registro.

## Qué no existe hoy
- `alertas_cierre_solo_clave_vieja`: las preguntas del Coordinador con la clave vieja `coord:necesita:<texto>` (sin el id de la tarjeta) no se cierran solas ni enlazan a la tarjeta; solo las nuevas `coord:necesita:<id>:<texto>`. Las viejas se cierran a mano en /cliente/alertas.
