## Entidades
- `HistorialEtapa`: una fila por cada cambio de etapa del CRM (cliente, chat si se sabe, etapa anterior y nueva, fecha y hora, origen ASESORA/BOT/AUTOMATICO/MCP/SISTEMA, quién y nota). La escribe `registrarCambioDeEtapa` (`src/lib/historial-etapa.ts`) y empieza vacía el día que sube.

## Qué no existe hoy
- `fecha_cambio_de_etapa_anterior`: el historial de etapas solo existe desde que subió; los cambios anteriores siguen con fecha aproximada (la última vez que se tocó la ficha). `listar_conversaciones` marca cada fila como `real` o `aproximada`. La herramienta del MCP para mover etapas no existe (el origen `MCP` queda listo para cuando exista).
