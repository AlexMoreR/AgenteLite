## Entidades
- `CerebroNotaPorCrear`: pedido de una nota NUEVA del cerebro que crea aizen1 (ruta relativa a la carpeta del cerebro, contenido completo, estado PENDIENTE → CREADA | ERROR con motivo, quién y desde dónde). Nunca se borra: queda como registro.

## Automatizaciones
- `cerebro_notas_en_aizen1`: la cuenta de servicio de Google no puede crear archivos en un Drive personal (403 storageQuotaExceeded). Cuando `cerebro_escribir` (modo crear) o "Pasar al cerebro" a un documento nuevo choca con eso, el CRM deja un `CerebroNotaPorCrear` PENDIENTE y responde "Se crea en aizen1 en ~1 minuto" (no es error). El Coordinador (`trabajador-tablero/lib/notas-boveda.mjs`), si tiene `boveda.ruta` en `config.local.json`, cada minuto pide las pendientes (`GET /api/trabajador/cerebro/notas-por-crear`), escribe `<boveda.ruta>/<ruta>` y la marca CREADA o ERROR (`POST`, misma clave `aizen_trab_...`). Drive para escritorio la sube a nombre del dueño y desde la siguiente sincronización el CRM la edita.

## Advertencias de operación
- `cerebro_notas_en_aizen1`: aizen1 NUNCA sobrescribe: si el archivo ya existe agrega el contenido al final tras una línea `---`. Rechaza (ERROR con motivo) rutas con `..`, absolutas o de unidad, que salen por un enlace, o que no son .md/.txt. Si aizen1 está apagado o la carpeta no existe, las notas quedan PENDIENTES (se ven así en Mi empresa → Cerebro y en `cerebro_listar` → `notas_nuevas`). Mientras la nota no se sincroniza al CRM, una segunda decisión con modo crear y el mismo nombre se agrega al final del mismo archivo.
