# Bitácora de incidentes: aizencrm

Qué es: cada vez que una subida de este repo falla (no arrancó, la vigilancia de 30 min la deshizo o falló el ensayo de
migraciones), queda una entrada acá con qué falló, la causa, cómo se resolvió y la regla que deja. El Coordinador lee las
últimas entradas antes de planear y antes de construir (en aizen1 y en la nube) y las pone en las instrucciones como
«Incidentes ya vistos en este repo: no los repitas». Junta este archivo con las entradas nuevas que anota en su carpeta de
trabajo (`incidentes/aizencrm.md`), sin repetir las que ya están acá.

Formato de cada entrada (el mismo de `armarEntrada` en `trabajador-tablero/lib/bitacora.mjs`):

- un título de nivel 3 con la fecha (hora de Bogotá), el id de la tarjeta y su título;
- la clave estable en un comentario, `<!-- incidente:<tarjeta>:<fecha> -->`, que no se cambia (con ella no se repite la entrada);
- las líneas `- Repo:`, `- Qué falló:`, `- Causa:`, `- Cómo se resolvió:` y `- Regla:`;
- si hay, las líneas del error en un bloque de código.

Lo que no se encuentra queda como «causa no registrada»: nunca se inventa una causa. Las entradas de antes de la bitácora
salen del historial de git; los números T-819 y T-872 salen del plan de la tarjeta, porque el historial del CRM no se pudo
leer desde la sesión que las escribió.

### 2026-11-15 18:03 · T-819 Vigilancia: la vigilancia de 30 min revirtió la bandeja sin internos (parte 4)
<!-- incidente:T-819:2026-11-15 18:03 -->

- Repo: aizencrm (commit 04411e38)
- Qué falló: la vigilancia de 30 min la deshizo
- Causa: La consulta de contactos internos de la bandeja (7ec0dcc4) usaba pg_input_is_valid, que es de Postgres 16: producción no tiene las funciones de Postgres 16 y la consulta fallaba.
- Cómo se resolvió: Se rehízo en la tarjeta de vigilancia 7atiuw03 (commit 9c2ed293): una sola consulta con regexp_matches, compatible con Postgres < 16, sin subir el tope de 11 consultas en frío.
- Regla: No usar funciones de Postgres 16 que producción no tiene.

### 2026-11-24 08:03 · T-872 Vigilancia: errores de Prisma de varias líneas y cortes de red en los registros
<!-- incidente:T-872:2026-11-24 08:03 -->

- Repo: aizencrm
- Qué falló: la vigilancia de 30 min la deshizo
- Causa: Los errores de Prisma de varias líneas (P1001, P2002) llegaban partidos a los registros y la vigilancia solo veía la primera línea; los cortes de red pasajeros (ECONNRESET, EAI_AGAIN, 'The operation was aborted due to timeout') del push y del webhook de Evolution contaban como fallas. El commit exacto de la reversión no quedó en git.
- Cómo se resolvió: Commits 97ca87bc y a79ab2f9 (errores de Prisma y de las rutas de envío del chat en una sola línea) y d08b4e2c (cortes de red pasajeros en una línea informativa).
- Regla: Leer el error completo, no solo la primera línea; los cortes de red son pasajeros y se reintentan.

### 2026-11-15 18:03 · 5xhekj5w Bandeja de chats: sacar los avisos internos (parte 4)
<!-- incidente:5xhekj5w:2026-11-15 18:03 -->

- Repo: aizencrm (commit 04411e38)
- Qué falló: la vigilancia de 30 min la deshizo
- Causa: La consulta nueva de contactos internos usaba pg_input_is_valid (función de Postgres 16 que producción no tiene). Ver T-819.
- Cómo se resolvió: Revert 04411e38 de 7ec0dcc4 (las migraciones nuevas se conservan); se rehízo en 9c2ed293 el 24-nov.
- Regla: No usar funciones de Postgres 16 que producción no tiene.

### 2026-11-15 20:56 · rlieyfk9 Fotos enviadas: se queda encima un cuadrito
<!-- incidente:rlieyfk9:2026-11-15 20:56 -->

- Repo: aizencrm (commit 0879c1f3)
- Qué falló: la vigilancia de 30 min la deshizo
- Causa: causa no registrada
- Cómo se resolvió: Revert 0879c1f3 de 3de1826f (chat-conversation-panel.tsx y fotos-en-envio.test.ts); las migraciones nuevas se conservan.
- Regla: Leer los registros completos del servidor y anotar la causa cuando se sepa.

### 2026-11-19 15:03 · 89e50j8w Chats de la página web visibles en el CRM
<!-- incidente:89e50j8w:2026-11-19 15:03 -->

- Repo: aizencrm (commit a682f50d)
- Qué falló: la vigilancia de 30 min la deshizo
- Causa: causa no registrada
- Cómo se resolvió: Revert a682f50d de e2238fbf (origen-web.ts y el webhook de Evolution); las migraciones nuevas se conservan.
- Regla: Leer los registros completos del servidor y anotar la causa cuando se sepa.

### 2026-11-24 01:47 · bm18g7t3 Equipo: ver la última conexión y actividad
<!-- incidente:bm18g7t3:2026-11-24 01:47 -->

- Repo: aizencrm (commit e617aabf)
- Qué falló: no arrancó
- Causa: causa no registrada
- Cómo se resolvió: Revert e617aabf de 470c7f1d (ultima-accion.ts, actividad.ts y hora-de-lista.ts) porque el despliegue falló; las migraciones nuevas se conservan.
- Regla: Leer los registros completos del servidor y anotar la causa cuando se sepa.
