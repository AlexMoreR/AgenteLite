# CLAUDE.md

Las reglas generales del proyecto (estructura, comandos, convenciones, componentes) están en
[`AGENTS.md`](AGENTS.md). Este archivo documenta lo que es específico de trabajar con Claude.

## La herramienta del MCP `que_es_esta_aplicacion`

Es la primera herramienta del MCP del CRM y la que un asesor de IA debería llamar al empezar: explica el
sistema completo sin que Alex lo tenga que contar cada vez. Es de solo lectura.

- Código: [`src/lib/mcp/que-es-esta-aplicacion.ts`](src/lib/mcp/que-es-esta-aplicacion.ts), registrada en
  [`src/lib/mcp/herramientas.ts`](src/lib/mcp/herramientas.ts).
- Texto editable: [`docs/que-es-esta-aplicacion.md`](docs/que-es-esta-aplicacion.md).

### Qué sale en vivo y qué sale del archivo

Lo que se puede leer del sistema que está corriendo se lee **en vivo**, y no puede quedar desactualizado:

| Parte | De dónde sale |
|---|---|
| Versiones del stack | `package.json` |
| Pantallas (módulos) | las rutas `/cliente/*` del build (`.next/server/app/cliente`); en desarrollo, `src/app/cliente` |
| Modelo de datos | `prisma/schema.prisma`: cada modelo, sus relaciones y los enums |
| Líneas de WhatsApp | la base: tipo (ventas o administrativa), gateway, quién la atiende, colaboradoras |
| Agentes | la base: qué agente atiende cada línea, los V1/V2 y el libro del V3 |
| Automatizaciones | las banderas en `AppSetting` y las tablas (reglas prendidas, campañas en curso, último informe) |
| Arranque del contenedor | `docker/entrypoint.sh` (si migra antes de arrancar y con `set -eu`) |

Lo que el código no sabe sale del archivo `docs/que-es-esta-aplicacion.md`: qué es el negocio y qué
problema resuelve, el despliegue, qué hace cada módulo, entidad y automatización, la explicación de los
agentes, los conceptos del negocio, **lo que no existe hoy** y las advertencias de operación.

El código fuente (`src/`) **no viaja en la imagen de producción**: por eso las pantallas se leen del
build. El archivo `.md` sí viaja porque el `Dockerfile` lo copia; si se mueve o se renombra, hay que
actualizar esa línea del `Dockerfile`.

### Cómo mantener el archivo al día

La herramienta cruza lo que existe con lo que está escrito y lo avisa en su respuesta:

- `falta_describir`: un modelo de Prisma, una pantalla o una automatización que existe y no tiene línea
  en el archivo.
- `descrito_pero_no_existe`: una línea del archivo sobre algo que ya no existe.

Al agregar un modelo, una pantalla o una automatización nueva, agregar su línea en la sección
correspondiente (`- \`clave\`: descripción`). La clave tiene que coincidir con el código: el nombre
del modelo, la carpeta de `src/app/cliente` o la clave de la automatización en
`que-es-esta-aplicacion.ts`. Una automatización nueva también necesita su estado en la función
`automatizaciones()` de ese archivo.

Al descubrir una limitación nueva (un dato que no se guarda, un campo que falta) o una trampa de
operación, agregarla en "Qué no existe hoy" o en "Advertencias de operación". Los títulos `## ...` no se
cambian: la herramienta busca cada sección por su título.

Si una fuente en vivo falla (por ejemplo, la base no responde), la respuesta lo dice en
`no_se_pudo_leer` y el resto sale igual.

### Probarla sin la base

Desde una máquina sin acceso a la base se puede correr todo lo que no sea la base con Node y un
cargador que resuelva los alias `@/`. Las partes de la base salen como `no_se_pudo_leer`, que es lo
esperado. Las líneas, los agentes y las automatizaciones solo se pueden comprobar en producción,
llamando a la herramienta por el MCP.
