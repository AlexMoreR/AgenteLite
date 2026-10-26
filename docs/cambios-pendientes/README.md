# Cambios pendientes del manual

Las tareas **no editan** `docs/que-es-esta-aplicacion.md` (todas lo tocaban y el Coordinador no deja correr
juntas dos tareas que tocan el mismo archivo). En vez de eso, cada tarea deja aquí **una nota corta** con lo
que cambió, en su propio archivo: `docs/cambios-pendientes/<id-corto-de-la-tarjeta>.md`. Así dos tareas nunca
chocan por las notas.

Una vez al día, de noche (por defecto 23:00 hora de Bogotá), el Coordinador junta las notas en el manual,
sube el cambio a `main` y borra las notas que pasó (`trabajador-tablero/lib/manual-nocturno.mjs`).
Este README no se junta ni se borra.

## Formato de una nota

Solo se escribe si el cambio agrega un modelo, una pantalla, una automatización, una limitación o una
advertencia de operación. Cada línea va bajo el título `## ...` **exacto** de la sección del manual a la
que pertenece, con la forma ``- `clave`: descripción`` (la clave es la misma que usa el código: el nombre
del modelo, la carpeta de `src/app/cliente` o la clave de la automatización).

Ejemplo (`docs/cambios-pendientes/ab12cd34.md`):

```md
## Qué no existe hoy
- `recordatorios_por_voz`: los recordatorios solo salen por texto; no hay llamadas ni notas de voz.

## Advertencias de operación
- `cron_recordatorios`: corre cada 5 minutos; si se apaga el contenedor, los recordatorios vencidos salen todos juntos al volver.
```

Si una nota no se entiende, el Coordinador la deja sin borrar y lo dice en su aviso.
