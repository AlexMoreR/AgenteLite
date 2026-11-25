## Stack y despliegue
- `postgres-de-pruebas`: las pruebas de SQL corren en la misma versión mayor de Postgres que producción, escrita en `src/lib/postgres-produccion.json` (`mayor`, hoy 15 provisional). `npm test` (`scripts/correr-pruebas-ci.mjs`) levanta `postgres:<mayor>-alpine` con Docker y cada prueba abre su base con `abrirBaseDePruebas()` (`scripts/lib/base-de-pruebas.mjs`); en GitHub Actions («CI tablero») es obligatorio. Sin Docker (la nube, aizen1 sin Docker) las pruebas usan PGlite (Postgres 17 embebido) más el chequeo estático `npm run test:sql-version-postgres`, que frena SQL de una versión mayor que la de producción.

## Advertencias de operación
- `postgres-de-pruebas`: si se actualiza el Postgres de producción, hay que cambiar `mayor` en `src/lib/postgres-produccion.json` (y poner `provisional: false`); si no, las pruebas siguen en la versión vieja. El MCP `que_es_esta_aplicacion` lee la versión en vivo y avisa si no coincide.
