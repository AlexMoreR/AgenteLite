## Automatizaciones
- `cerebro_sincronizacion`: el Cerebro ignora (no recorre, no indexa, no muestra) todo archivo o carpeta cuyo nombre empiece con punto (`.git`, `.obsidian`, `.claude`, `.gitignore`…) sin entrar en esas carpetas, las rutas de `RUTAS_IGNORADAS` en `src/features/cerebro/services/reglas.ts` (hoy `CRM-Gestion/export-dudas-2026-10-26` y todo lo de adentro) y las imágenes `.png`. Regla única: `seIgnora(ruta, nombre, tipo)`. Las filas que ya estaban en la copia y ahora se ignoran se marcan `enDrive = false` (igual que "ya no está en Drive"), aunque el recorrido venga truncado; no se borra ninguna fila ni nada del Drive.

## Pantallas
- `negocio/cerebro`: muestra "N documentos en el cerebro" (solo documentos, sin carpetas, sin ignorados ni ausentes). `cerebro_listar` del MCP devuelve lo mismo en `documentos_en_el_cerebro`.

## Advertencias de operación
- `cerebro_sincronizacion`: para ignorar otra carpeta se agrega su ruta (relativa a la carpeta del cerebro, sin importar mayúsculas) a `RUTAS_IGNORADAS`. Documentos del cerebro en SQL: `SELECT count(*) FROM "CerebroDocumento" WHERE "workspaceId" = '<ws>' AND "enDrive" AND NOT "esCarpeta"` (tras la primera sincronización con este cambio).
