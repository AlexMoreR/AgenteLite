## Entidades
- `HistorialEtapa`: una fila por cada cambio de etapa del CRM (cliente, chat si se sabe, etapa anterior y nueva, fecha, origen ASESORA/BOT/AUTOMATICO/MCP/SISTEMA y quién). Empieza vacía el día que sube.

## Qué no existe hoy
- `historial_etapa_anterior_a_la_subida`: los cambios de etapa hechos antes de crear `HistorialEtapa` no tienen fecha real; `listar_conversaciones` los marca como "aproximada". Tampoco existe todavía una herramienta del MCP que mueva etapas (el origen `MCP` está listo para cuando exista).
