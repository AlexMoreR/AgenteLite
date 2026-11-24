## Advertencias de operación
- `postgres_produccion`: la versión mayor de Postgres de producción está escrita en `src/lib/postgres-produccion.json` y `npm run test:sql-version-postgres` frena toda SQL de una versión mayor. Hoy dice 15 como provisional (no se pudo leer desde la nube); `que_es_esta_aplicacion` lee `SHOW server_version` en vivo y avisa si no coincide.
