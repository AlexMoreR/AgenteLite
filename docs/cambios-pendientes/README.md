# Cambios pendientes del manual

Las tareas **no editan** `docs/que-es-esta-aplicacion.md`. Si su cambio agrega un modelo, una pantalla, una
automatización, una limitación o una advertencia de operación, dejan una nota corta en esta carpeta, **un archivo por
tarea**: `docs/cambios-pendientes/<id-corto-de-la-tarjeta>.md`. Así dos tareas nunca chocan por el manual.

Una vez cada noche (23:00, hora de Bogotá) el Coordinador junta las notas en el manual, sube el cambio a main y borra
las notas (`trabajador-tablero/lib/manual-nocturno.mjs`). El README de esta carpeta no se junta ni se borra.

## Cómo se escribe una nota

- Un título `## ...` igual al de la sección del manual donde va cada línea.
- Debajo, líneas `- \`clave\`: descripción`, con la misma clave que usa el código (el nombre del modelo, la carpeta de
  `src/app/cliente` o la clave de la automatización en `que-es-esta-aplicacion.ts`).
- Si cambia una línea que ya existe en el manual, se repite la clave con la descripción nueva.

## Ejemplo (`docs/cambios-pendientes/ab12cd34.md`)

```md
## Modelo de datos
- `TarjetaTablero`: guarda también el motivo del último error.

## Advertencias de operación
- `manual-nocturno`: el manual se pone al día solo una vez al día; entre tanto `falta_describir` puede mostrar el cambio.
```
