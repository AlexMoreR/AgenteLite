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

### fecha no registrada · T-940 Tarjeta planeada en el repo equivocado
<!-- incidente:T-940:fecha no registrada -->

- Repo: aizencrm
- Qué falló: el plan nombra archivos que no están en este repo (repo equivocado)
- Causa: La tarjeta se planeó en el repo equivocado: los archivos que nombraba estaban en el otro repo.
- Qué se intentó: no registrado
- Cómo se resolvió: se cambió la tarjeta de repo (o se vuelve a planear) sin construir ni gastar intento
- Regla: Buscar los archivos de la tarjeta en cada repo antes de planear; si están en el otro, cambiar el repo.

### 2026-11-25 11:55 · r2za3g8z Panel Cuentas 7 días: quitar botón, nombres en mayúscula, verdes primero con punto animado — parte 1: Tabla de cuentas: sin botón y nombres en MAYÚSCULAS
<!-- incidente:r2za3g8z:2026-11-25 11:55 -->

- Repo: aizencrm
- Qué falló: Claude terminó sin cambiar ningún archivo
- Causa: Claude terminó sin cambiar ningún archivo
- Qué se intentó: intento 1 de 3 (no_cambio_nada; no cambió nada y no está en main: se reintenta con la estrategia plan_nuevo (1 de 3))
- Cómo se resolvió: se vuelve a planear la tarea
- Regla: Si Claude no cambia nada, mirar si ya está en main o volver a planear con lo que falta, sin repetir lo mismo.

Líneas del error:

```
Claude no cambió ningún archivo.
```

### 2026-11-25 13:56 · r2za3g8z Panel Cuentas 7 días: quitar botón, nombres en mayúscula, verdes primero con punto animado — parte 1: Tabla de cuentas: sin botón y nombres en MAYÚSCULAS
<!-- incidente:r2za3g8z:2026-11-25 13:56 -->

- Repo: aizencrm
- Qué falló: la sesión de la nube no dio señal ni dejó su resultado
- Causa: La sesión de la nube no dejó el commit "resultado:" en la rama tablero/r2za3g8z-panel-cuentas-7-dias-quitar-boton-nombre-nube2 en 120 min (¿s… — https://claude.ai/code/session_01XuE6FcjYyStumTw1V8rNwd
- Qué se intentó: intento 2 de 3 (nube_sin_resultado, con la estrategia plan_nuevo; la nube no dio señal: se reintenta con la estrategia sesion_nueva (2 de 3))
- Cómo se resolvió: reintento en una sesión nueva de la nube (nunca la de un intento anterior)
- Regla: Si la nube no da señal, se reintenta en una sesión nueva; nunca en la misma sesión de un intento anterior.

Líneas del error:

```
La sesión de la nube no dejó el commit "resultado:" en la rama tablero/r2za3g8z-panel-cuentas-7-dias-quitar-boton-nombre-nube2 en 120 min (¿se quedó pensando o hizo una pregunta?). Mírala: https://claude.ai/code/session_01XuE6FcjYyStumTw1V8rNwd
```

### 2026-11-25 15:56 · r2za3g8z Panel Cuentas 7 días: quitar botón, nombres en mayúscula, verdes primero con punto animado — parte 1: Tabla de cuentas: sin botón y nombres en MAYÚSCULAS
<!-- incidente:r2za3g8z:2026-11-25 15:56 -->

- Repo: aizencrm
- Qué falló: la sesión de la nube no dio señal ni dejó su resultado
- Causa: La sesión de la nube no dejó el commit "resultado:" en la rama tablero/r2za3g8z-panel-cuentas-7-dias-quitar-boton-nombre-nube3 en 120 min (¿s… — https://claude.ai/code/session_01XuE6Fe1Hnrrrm7PgWQwMw4
- Qué se intentó: intento 3 de 3 (nube_sin_resultado, con la estrategia sesion_nueva; la nube no dio señal: se reintenta con la estrategia opus (3 de 3))
- Cómo se resolvió: la tarjeta vuelve a la fila para repararla (estrategia opus)
- Regla: Si la nube no da señal, se reintenta en una sesión nueva; nunca en la misma sesión de un intento anterior.

Líneas del error:

```
La sesión de la nube no dejó el commit "resultado:" en la rama tablero/r2za3g8z-panel-cuentas-7-dias-quitar-boton-nombre-nube3 en 120 min (¿se quedó pensando o hizo una pregunta?). Mírala: https://claude.ai/code/session_01XuE6Fe1Hnrrrm7PgWQwMw4
```

### 2026-11-25 17:57 · r2za3g8z Panel Cuentas 7 días: quitar botón, nombres en mayúscula, verdes primero con punto animado — parte 1: Tabla de cuentas: sin botón y nombres en MAYÚSCULAS
<!-- incidente:r2za3g8z:2026-11-25 17:57 -->

- Repo: aizencrm
- Qué falló: la sesión de la nube no dio señal ni dejó su resultado
- Causa: La sesión de la nube no dejó el commit "resultado:" en la rama tablero/r2za3g8z-panel-cuentas-7-dias-quitar-boton-nombre-nube4 en 120 min (¿s… — https://claude.ai/code/session_01XuE6FZbFpF2JkFsN7heYZg
- Qué se intentó: intento 4 de 3 (nube_sin_resultado, con la estrategia opus; la nube no dio señal tras 3 intentos distintos (tope 3): una sola alerta, solo en la página)
- Cómo se resolvió: pasó al dueño con un resumen de la falla (ERROR)
- Regla: Si la nube no da señal, se reintenta en una sesión nueva; nunca en la misma sesión de un intento anterior.

Líneas del error:

```
La sesión de la nube no dejó el commit "resultado:" en la rama tablero/r2za3g8z-panel-cuentas-7-dias-quitar-boton-nombre-nube4 en 120 min (¿se quedó pensando o hizo una pregunta?). Mírala: https://claude.ai/code/session_01XuE6FZbFpF2JkFsN7heYZg
```

### 2026-11-25 20:19 · qhf7ji14 URGENTE: Chats más rápido: leer solo source de rawPayload, cache en contadores y medir bloqueo de Node — parte 1: Medir cuánto se traba Node en el log [timing]…
<!-- incidente:qhf7ji14:2026-11-25 20:19 -->

- Repo: aizencrm (commit 887d62aae6)
- Qué falló: la vigilancia de 30 min la deshizo
- Causa: Después de subir aparecieron fallas nuevas del programa, así que el cambio tiene un error que hay que corregir. Revertida: 3 línea(s) de falla nueva(s) en los logs: [minuto 6] [prisma] {"causa":"base","codigo":null,"error":"Invalid `prisma.historialTarjeta.findMany()` invocation:"} | [minuto 6] [trabajador-tab…
- Qué se intentó: intento 1 de 3 (subida a producción)
- Cómo se resolvió: tarjeta 'Arreglo de subida'
- Regla: Leer el error completo, no solo la primera línea.

Líneas del error:

```
3 línea(s) de falla nueva(s) en los logs: [minuto 6] [prisma] {"causa":"base","codigo":null,"error":"Invalid `prisma.historialTarjeta.findMany()` invocation:"} | [minuto 6] [trabajador-tablero] falló Error [PrismaClientKnownRequestError]: | [minuto 6] Transaction API error: A batch query cannot be …
[trabajador-tablero] falló Error [PrismaClientKnownRequestError]:
```

### 2026-11-26 01:05 · qhf7ji14 URGENTE: Chats más rápido: leer solo source de rawPayload, cache en contadores y medir bloqueo de Node — parte 1: Medir cuánto se traba Node en el log [timing]…
<!-- incidente:qhf7ji14:2026-11-26 01:05 -->

- Repo: aizencrm
- Qué falló: la sesión de la nube no dio señal ni dejó su resultado
- Causa: La sesión de la nube no dejó el commit "resultado:" en la rama tablero/qhf7ji14-urgente-chats-mas-rapido-leer-solo-sourc-nube2 en 120 min (¿s… — https://claude.ai/code/session_01XuE6FcBmmUp9EKJq1AaotC
- Qué se intentó: intento 1 de 3 (nube_sin_resultado; la nube no dio señal: se reintenta con la estrategia sesion_nueva (1 de 3))
- Cómo se resolvió: reintento en una sesión nueva de la nube (nunca la de un intento anterior)
- Regla: Si la nube no da señal, se reintenta en una sesión nueva; nunca en la misma sesión de un intento anterior.

Líneas del error:

```
La sesión de la nube no dejó el commit "resultado:" en la rama tablero/qhf7ji14-urgente-chats-mas-rapido-leer-solo-sourc-nube2 en 120 min (¿se quedó pensando o hizo una pregunta?). Mírala: https://claude.ai/code/session_01XuE6FcBmmUp9EKJq1AaotC
```

### 2026-11-26 05:01 · ovn3u6hs Refrescos automáticos más livianos: campana, pestañas ocultas, fotos del chat — parte 3: Bandeja: conteos compartidos entre pestañas, precarga de Mías pausada …
<!-- incidente:ovn3u6hs:2026-11-26 05:01 -->

- Repo: aizencrm
- Qué falló: Claude terminó sin cambiar ningún archivo
- Causa: Claude terminó sin cambiar ningún archivo
- Qué se intentó: intento 1 de 3 (no_cambio_nada; no cambió nada y no está en main: se reintenta con la estrategia plan_nuevo (1 de 3))
- Cómo se resolvió: se vuelve a planear la tarea
- Regla: Si Claude no cambia nada, mirar si ya está en main o volver a planear con lo que falta, sin repetir lo mismo.

Líneas del error:

```
Claude no cambió ningún archivo.
```

### 2026-11-26 22:11 · kwt102sn URGENTE: Índices de Message para última acción y no leídos (sin trabar escrituras) — parte 2: Última acción del Equipo con unnest + LATERAL usando los índices …
<!-- incidente:kwt102sn:2026-11-26 22:11 -->

- Repo: aizencrm
- Qué falló: la sesión de la nube no dio señal ni dejó su resultado
- Causa: La sesión de la nube no dejó el commit "resultado:" en la rama tablero/kwt102sn-urgente-indices-de-message-para-ultima-a-nube3 en 120 min (¿s… — https://claude.ai/code/session_01XuE6FcTkhc54J4PryVJrxW
- Qué se intentó: intento 3 de 3 (nube_sin_resultado; la nube no dio señal: se reintenta con la estrategia sesion_nueva (3 de 3))
- Cómo se resolvió: reintento en una sesión nueva de la nube (nunca la de un intento anterior)
- Regla: Si la nube no da señal, se reintenta en una sesión nueva; nunca en la misma sesión de un intento anterior.

Líneas del error:

```
La sesión de la nube no dejó el commit "resultado:" en la rama tablero/kwt102sn-urgente-indices-de-message-para-ultima-a-nube3 en 120 min (¿se quedó pensando o hizo una pregunta?). Mírala: https://claude.ai/code/session_01XuE6FcTkhc54J4PryVJrxW
```

### 2026-11-26 22:36 · ucygr9bp Coordinador: si una reparación falla por el mismo motivo, no repetir igual y dej — parte 1: La nube que ya contestó DEPENDE_DE o YA_ESTA_HECHO se cierra al mom…
<!-- incidente:ucygr9bp:2026-11-26 22:36 -->

- Repo: aizencrm
- Qué falló: el plan nombra archivos que no están en este repo (repo equivocado)
- Causa: El plan nombra archivos que no están en aizencrm ni en el otro repo: revision-previa.mjs, etapas.mjs, git.mjs, pruebas/gh-falso.mjs, claude-falso.mjs y 1 más
- Qué se intentó: intento 1 de 2 (antes_de_construir; se vuelve a planear)
- Cómo se resolvió: se cambió la tarjeta de repo (o se vuelve a planear) sin construir ni gastar intento
- Regla: Si el plan nombra archivos de otro repo, se cambia la tarjeta de repo y se vuelve a planear; nunca se construye en el repo equivocado.

Líneas del error:

```
no está en aizencrm: revision-previa.mjs
no está en aizencrm: etapas.mjs
no está en aizencrm: git.mjs
no está en aizencrm: pruebas/gh-falso.mjs
no está en aizencrm: claude-falso.mjs
no está en aizencrm: bucle.mjs
```

### 2026-11-26 22:37 · ca1k25c2 Tablero IA: vista tipo tablero (columnas por estado) de lo que cuelga de Features — parte 1: Lectura de las tarjetas de Features en columnas (servicio, acción …
<!-- incidente:ca1k25c2:2026-11-26 22:37 -->

- Repo: aizencrm
- Qué falló: el plan nombra archivos que no están en este repo (repo equivocado)
- Causa: El plan nombra archivos que no están en aizencrm ni en el otro repo: src/features/tableros-inteligentes/services/tablero-de-features.ts, services/sql-features.ts, vistas-de-tabla.ts, services/coordin…
- Qué se intentó: intento 1 de 2 (antes_de_construir; se vuelve a planear)
- Cómo se resolvió: se cambió la tarjeta de repo (o se vuelve a planear) sin construir ni gastar intento
- Regla: Si el plan nombra archivos de otro repo, se cambia la tarjeta de repo y se vuelve a planear; nunca se construye en el repo equivocado.

Líneas del error:

```
no está en aizencrm: src/features/tableros-inteligentes/services/tablero-de-features.ts
no está en aizencrm: services/sql-features.ts
no está en aizencrm: vistas-de-tabla.ts
no está en aizencrm: services/coordinador-en-vivo.ts
no está en aizencrm: src/app/actions/tablero-ia-features-actions.ts
no está en aizencrm: scripts/check-tablero-features-kanban.mjs
```

### 2026-11-26 22:39 · ca1k25c2 Tablero IA: vista tipo tablero (columnas por estado) de lo que cuelga de Features — parte 1: Lectura de las tarjetas de Features en columnas (servicio, acción …
<!-- incidente:ca1k25c2:2026-11-26 22:39 -->

- Repo: aizencrm
- Qué falló: el plan nombra archivos que no están en este repo (repo equivocado)
- Causa: El plan nombra archivos que no están en aizencrm ni en el otro repo: services/reglas.ts, coordinador-en-vivo.ts, services/vistas-de-tabla.ts, services/coordinador-en-vivo.ts, services/sql-features.ts…
- Qué se intentó: intento 2 de 2 (antes_de_construir; se vuelve a planear)
- Cómo se resolvió: se cambió la tarjeta de repo (o se vuelve a planear) sin construir ni gastar intento
- Regla: Si el plan nombra archivos de otro repo, se cambia la tarjeta de repo y se vuelve a planear; nunca se construye en el repo equivocado.

Líneas del error:

```
no está en aizencrm: services/reglas.ts
no está en aizencrm: coordinador-en-vivo.ts
no está en aizencrm: services/vistas-de-tabla.ts
no está en aizencrm: services/coordinador-en-vivo.ts
no está en aizencrm: services/sql-features.ts
no está en aizencrm: sql-features.ts
```

### 2026-11-26 22:53 · ucygr9bp Coordinador: si una reparación falla por el mismo motivo, no repetir igual y dej — parte 1: La nube que ya contestó DEPENDE_DE o YA_ESTA_HECHO se cierra al mom…
<!-- incidente:ucygr9bp:2026-11-26 22:53 -->

- Repo: aizencrm
- Qué falló: el plan nombra archivos que no están en este repo (repo equivocado)
- Causa: El plan nombra archivos que no están en aizencrm ni en el otro repo: revision-previa.mjs, bucle.mjs, etapas.mjs, git.mjs, pruebas/gh-falso.mjs
- Qué se intentó: intento 2 de 2 (antes_de_construir; se vuelve a planear)
- Cómo se resolvió: se cambió la tarjeta de repo (o se vuelve a planear) sin construir ni gastar intento
- Regla: Si el plan nombra archivos de otro repo, se cambia la tarjeta de repo y se vuelve a planear; nunca se construye en el repo equivocado.

Líneas del error:

```
no está en aizencrm: revision-previa.mjs
no está en aizencrm: bucle.mjs
no está en aizencrm: etapas.mjs
no está en aizencrm: git.mjs
no está en aizencrm: pruebas/gh-falso.mjs
```

### 2026-11-26 23:07 · pqsohatw Coordinador: detectar tarjetas repetidas antes de planear — parte 1: CRM: consulta "parecidas" y acción "repetida" con historial en las dos tarjetas
<!-- incidente:pqsohatw:2026-11-26 23:07 -->

- Repo: aizencrm
- Qué falló: el plan nombra archivos que no están en este repo (repo equivocado)
- Causa: El plan nombra archivos que no están en aizencrm ni en el otro repo: trabajador.ts
- Qué se intentó: intento 1 de 2 (antes_de_construir; se vuelve a planear)
- Cómo se resolvió: se cambió la tarjeta de repo (o se vuelve a planear) sin construir ni gastar intento
- Regla: Si el plan nombra archivos de otro repo, se cambia la tarjeta de repo y se vuelve a planear; nunca se construye en el repo equivocado.

Líneas del error:

```
no está en aizencrm: trabajador.ts
```

### 2026-11-26 23:16 · wyn70g97 Bot: cuando llega de magilus.com con una referencia, mandar la foto o ficha técnica de ese producto
<!-- incidente:wyn70g97:2026-11-26 23:16 -->

- Repo: aizencrm
- Qué falló: el plan nombra archivos que no están en este repo (repo equivocado)
- Causa: El plan nombra archivos que no están en aizencrm ni en el otro repo: src/features/agente-v3/motor/producto-del-mensaje.test.ts
- Qué se intentó: intento 1 de 2 (antes_de_construir; se vuelve a planear)
- Cómo se resolvió: se cambió la tarjeta de repo (o se vuelve a planear) sin construir ni gastar intento
- Regla: Si el plan nombra archivos de otro repo, se cambia la tarjeta de repo y se vuelve a planear; nunca se construye en el repo equivocado.

Líneas del error:

```
no está en aizencrm: src/features/agente-v3/motor/producto-del-mensaje.test.ts
```

### 2026-11-26 23:16 · vroezxcl Tablero IA: toda Tarea nueva cae sola en Features si nadie le pone p — parte 1: Toda Tarea nueva sin padre en Empresa Magilus cae en Features, con aviso si el …
<!-- incidente:vroezxcl:2026-11-26 23:16 -->

- Repo: aizencrm
- Qué falló: el plan nombra archivos que no están en este repo (repo equivocado)
- Causa: El plan nombra archivos que no están en aizencrm ni en el otro repo: scripts/check-tareas-a-features.mjs
- Qué se intentó: intento 1 de 2 (antes_de_construir; se vuelve a planear)
- Cómo se resolvió: se cambió la tarjeta de repo (o se vuelve a planear) sin construir ni gastar intento
- Regla: Si el plan nombra archivos de otro repo, se cambia la tarjeta de repo y se vuelve a planear; nunca se construye en el repo equivocado.

Líneas del error:

```
no está en aizencrm: scripts/check-tareas-a-features.mjs
```

### 2026-11-26 23:17 · 7jmgy8ik Marca Magilus, versión numérica que sube sola y versión abierta por persona en Equipo
<!-- incidente:7jmgy8ik:2026-11-26 23:17 -->

- Repo: aizencrm
- Qué falló: el plan nombra archivos que no están en este repo (repo equivocado)
- Causa: El plan nombra archivos que no están en aizencrm ni en el otro repo: src/lib/version-del-crm.ts, scripts/check-marca-magilus.mjs, version-del-crm.test.ts, check-lineas-de-la-persona.ts, check-marca-m…
- Qué se intentó: intento 1 de 2 (antes_de_construir; se vuelve a planear)
- Cómo se resolvió: se cambió la tarjeta de repo (o se vuelve a planear) sin construir ni gastar intento
- Regla: Si el plan nombra archivos de otro repo, se cambia la tarjeta de repo y se vuelve a planear; nunca se construye en el repo equivocado.

Líneas del error:

```
no está en aizencrm: src/lib/version-del-crm.ts
no está en aizencrm: scripts/check-marca-magilus.mjs
no está en aizencrm: version-del-crm.test.ts
no está en aizencrm: check-lineas-de-la-persona.ts
no está en aizencrm: check-marca-magilus.mjs
no está en aizencrm: app-version-guard.tsx
```

### 2026-11-26 23:44 · pqsohatw Coordinador: detectar tarjetas repetidas antes de planear — parte 1: CRM: consulta "parecidas" y acción "repetida" con historial en las dos tarjetas
<!-- incidente:pqsohatw:2026-11-26 23:44 -->

- Repo: aizencrm
- Qué falló: el plan nombra archivos que no están en este repo (repo equivocado)
- Causa: El plan nombra archivos que no están en aizencrm ni en el otro repo: trabajador.ts, check-tableros-reglas.mjs, reglas-trabajador.ts, route.ts, crm.mjs y 2 más
- Qué se intentó: intento 2 de 2 (antes_de_construir; se vuelve a planear)
- Cómo se resolvió: se cambió la tarjeta de repo (o se vuelve a planear) sin construir ni gastar intento
- Regla: Si el plan nombra archivos de otro repo, se cambia la tarjeta de repo y se vuelve a planear; nunca se construye en el repo equivocado.

Líneas del error:

```
no está en aizencrm: trabajador.ts
no está en aizencrm: check-tableros-reglas.mjs
no está en aizencrm: reglas-trabajador.ts
no está en aizencrm: route.ts
no está en aizencrm: crm.mjs
no está en aizencrm: diagnostico.mjs
no está en aizencrm: tableros.ts
```

### 2026-11-26 23:52 · 7jmgy8ik Marca Magilus, versión numérica que sube sola y versión abierta por persona en Equipo
<!-- incidente:7jmgy8ik:2026-11-26 23:52 -->

- Repo: aizencrm
- Qué falló: el plan nombra archivos que no están en este repo (repo equivocado)
- Causa: El plan nombra archivos que no están en aizencrm ni en el otro repo: docker-image.yml, version-del-crm.test.ts
- Qué se intentó: intento 2 de 2 (antes_de_construir; se vuelve a planear)
- Cómo se resolvió: se cambió la tarjeta de repo (o se vuelve a planear) sin construir ni gastar intento
- Regla: Si el plan nombra archivos de otro repo, se cambia la tarjeta de repo y se vuelve a planear; nunca se construye en el repo equivocado.

Líneas del error:

```
no está en aizencrm: docker-image.yml
no está en aizencrm: version-del-crm.test.ts
```

### 2026-11-27 00:49 · 7rlezol8 Coordinador: si una reparación falla por el mismo motivo, no repetir igual y dejar escrito por qué — parte 2: DEPENDE_DE se resuelve con git y con el estado de…
<!-- incidente:7rlezol8:2026-11-27 00:49 -->

- Repo: aizencrm
- Qué falló: el plan nombra archivos que no están en este repo (repo equivocado)
- Causa: El plan nombra archivos que no están en aizencrm ni en el otro repo: reglas.ts, reglas-trabajador.ts, git.mjs, probar-trabajador.mjs, check-tableros-reglas.mjs y 1 más
- Qué se intentó: intento 1 de 2 (antes_de_construir; se vuelve a planear)
- Cómo se resolvió: se cambió la tarjeta de repo (o se vuelve a planear) sin construir ni gastar intento
- Regla: Si el plan nombra archivos de otro repo, se cambia la tarjeta de repo y se vuelve a planear; nunca se construye en el repo equivocado.

Líneas del error:

```
no está en aizencrm: reglas.ts
no está en aizencrm: reglas-trabajador.ts
no está en aizencrm: git.mjs
no está en aizencrm: probar-trabajador.mjs
no está en aizencrm: check-tableros-reglas.mjs
no está en aizencrm: trabajador.ts
```

### 2026-11-27 00:53 · 7rlezol8 Coordinador: si una reparación falla por el mismo motivo, no repetir igual y dejar escrito por qué — parte 2: DEPENDE_DE se resuelve con git y con el estado de…
<!-- incidente:7rlezol8:2026-11-27 00:53 -->

- Repo: aizencrm
- Qué falló: el plan nombra archivos que no están en este repo (repo equivocado)
- Causa: El plan nombra archivos que no están en aizencrm ni en el otro repo: reglas-trabajador.ts, tableros.ts, etapas.mjs, git.mjs, probar-fallas-repetidas.mjs y 2 más
- Qué se intentó: intento 2 de 2 (antes_de_construir; se vuelve a planear)
- Cómo se resolvió: se cambió la tarjeta de repo (o se vuelve a planear) sin construir ni gastar intento
- Regla: Si el plan nombra archivos de otro repo, se cambia la tarjeta de repo y se vuelve a planear; nunca se construye en el repo equivocado.

Líneas del error:

```
no está en aizencrm: reglas-trabajador.ts
no está en aizencrm: tableros.ts
no está en aizencrm: etapas.mjs
no está en aizencrm: git.mjs
no está en aizencrm: probar-fallas-repetidas.mjs
no está en aizencrm: probar-medir.mjs
no está en aizencrm: probar-repo-equivocado.mjs
```

### 2026-11-27 01:31 · 8yvjdvpw Bot no debe escribir en chats que ya atiende una asesora
<!-- incidente:8yvjdvpw:2026-11-27 01:31 -->

- Repo: aizencrm
- Qué falló: el plan nombra archivos que no están en este repo (repo equivocado)
- Causa: El plan nombra archivos que no están en aizencrm ni en el otro repo: route.ts, src/lib/bot-callado.ts, src/lib/bot-callado-servicio.ts, check-bot-callado.mjs
- Qué se intentó: intento 1 de 2 (antes_de_construir; se vuelve a planear)
- Cómo se resolvió: se cambió la tarjeta de repo (o se vuelve a planear) sin construir ni gastar intento
- Regla: Si el plan nombra archivos de otro repo, se cambia la tarjeta de repo y se vuelve a planear; nunca se construye en el repo equivocado.

Líneas del error:

```
no está en aizencrm: route.ts
no está en aizencrm: src/lib/bot-callado.ts
no está en aizencrm: src/lib/bot-callado-servicio.ts
no está en aizencrm: check-bot-callado.mjs
```

### 2026-11-27 01:32 · glvi3qw3 Listas de Chats: ordenar de más antiguo a más nuevo — parte 2: Las consultas de la bandeja respetan orden=antiguos
<!-- incidente:glvi3qw3:2026-11-27 01:32 -->

- Repo: aizencrm
- Qué falló: el plan nombra archivos que no están en este repo (repo equivocado)
- Causa: El plan nombra archivos que no están en aizencrm ni en el otro repo: Prisma.sql
- Qué se intentó: intento 1 de 2 (antes_de_construir; se vuelve a planear)
- Cómo se resolvió: se cambió la tarjeta de repo (o se vuelve a planear) sin construir ni gastar intento
- Regla: Leer el error completo, no solo la primera línea.

Líneas del error:

```
no está en aizencrm: Prisma.sql
```

### 2026-11-27 01:34 · ngn43dqj Agente V3: mensaje de respaldo cuando la IA no logra redactar — parte 1: El redactor dice por qué falló la IA y si la clienta recibió a — parte 1: La IA dice p…
<!-- incidente:ngn43dqj:2026-11-27 01:34 -->

- Repo: aizencrm
- Qué falló: el plan nombra archivos que no están en este repo (repo equivocado)
- Causa: El plan nombra archivos que no están en aizencrm ni en el otro repo: scripts/check-redactor-causa.mjs, redactor.ts, route.ts, retomar.ts
- Qué se intentó: intento 1 de 2 (antes_de_construir; se vuelve a planear)
- Cómo se resolvió: se cambió la tarjeta de repo (o se vuelve a planear) sin construir ni gastar intento
- Regla: Si el plan nombra archivos de otro repo, se cambia la tarjeta de repo y se vuelve a planear; nunca se construye en el repo equivocado.

Líneas del error:

```
no está en aizencrm: scripts/check-redactor-causa.mjs
no está en aizencrm: redactor.ts
no está en aizencrm: route.ts
no está en aizencrm: retomar.ts
```

### 2026-11-27 01:40 · ngn43dqj Agente V3: mensaje de respaldo cuando la IA no logra redactar — parte 1: El redactor dice por qué falló la IA y si la clienta recibió a — parte 1: La IA dice p…
<!-- incidente:ngn43dqj:2026-11-27 01:40 -->

- Repo: aizencrm
- Qué falló: el plan nombra archivos que no están en este repo (repo equivocado)
- Causa: El plan nombra archivos que no están en aizencrm ni en el otro repo: redactor.ts, retomar.ts, chats-actions.ts
- Qué se intentó: intento 2 de 2 (antes_de_construir; se vuelve a planear)
- Cómo se resolvió: se cambió la tarjeta de repo (o se vuelve a planear) sin construir ni gastar intento
- Regla: Si el plan nombra archivos de otro repo, se cambia la tarjeta de repo y se vuelve a planear; nunca se construye en el repo equivocado.

Líneas del error:

```
no está en aizencrm: redactor.ts
no está en aizencrm: retomar.ts
no está en aizencrm: chats-actions.ts
```

### 2026-11-27 01:48 · glvi3qw3 Listas de Chats: ordenar de más antiguo a más nuevo — parte 2: Las consultas de la bandeja respetan orden=antiguos
<!-- incidente:glvi3qw3:2026-11-27 01:48 -->

- Repo: aizencrm
- Qué falló: el plan nombra archivos que no están en este repo (repo equivocado)
- Causa: El plan nombra archivos que no están en aizencrm ni en el otro repo: chat-inbox-conversation-utils.ts, shared-inbox.tsx, page.tsx, route.ts, getOfficialApiChatsData.ts y 1 más
- Qué se intentó: intento 2 de 2 (antes_de_construir; se vuelve a planear)
- Cómo se resolvió: se cambió la tarjeta de repo (o se vuelve a planear) sin construir ni gastar intento
- Regla: Leer el error completo, no solo la primera línea.

Líneas del error:

```
no está en aizencrm: chat-inbox-conversation-utils.ts
no está en aizencrm: shared-inbox.tsx
no está en aizencrm: page.tsx
no está en aizencrm: route.ts
no está en aizencrm: getOfficialApiChatsData.ts
no está en aizencrm: Prisma.sql
```

### 2026-11-27 01:50 · 24xaj1hk Coordinador: mínimo 10 tareas trabajando a la vez; si baja, avisarle al dueño por qué — parte 1: CRM: meta editable, guardar tipo de espera y cupos, y calcular…
<!-- incidente:24xaj1hk:2026-11-27 01:50 -->

- Repo: aizencrm
- Qué falló: el plan nombra archivos que no están en este repo (repo equivocado)
- Causa: El plan nombra archivos que no están en aizencrm ni en el otro repo: src/features/tableros-inteligentes/services/meta-de-trabajo.ts, pausa-por-uso-de-claude.ts, scripts/check-meta-de-trabajo.mjs
- Qué se intentó: intento 1 de 2 (antes_de_construir; se vuelve a planear)
- Cómo se resolvió: se cambió la tarjeta de repo (o se vuelve a planear) sin construir ni gastar intento
- Regla: Si el plan nombra archivos de otro repo, se cambia la tarjeta de repo y se vuelve a planear; nunca se construye en el repo equivocado.

Líneas del error:

```
no está en aizencrm: src/features/tableros-inteligentes/services/meta-de-trabajo.ts
no está en aizencrm: pausa-por-uso-de-claude.ts
no está en aizencrm: scripts/check-meta-de-trabajo.mjs
```

### 2026-11-27 01:50 · vroezxcl Tablero IA: toda Tarea nueva cae sola en Features si nadie le pone p — parte 1: Toda Tarea nueva sin padre en Empresa Magilus cae en Features, con aviso si el …
<!-- incidente:vroezxcl:2026-11-27 01:50 -->

- Repo: aizencrm
- Qué falló: el plan nombra archivos que no están en este repo (repo equivocado)
- Causa: El plan nombra archivos que no están en aizencrm ni en el otro repo: reglas-features.ts, check-features-auto-aprobar.mjs, route.ts
- Qué se intentó: intento 2 de 2 (antes_de_construir; se vuelve a planear)
- Cómo se resolvió: se cambió la tarjeta de repo (o se vuelve a planear) sin construir ni gastar intento
- Regla: Si el plan nombra archivos de otro repo, se cambia la tarjeta de repo y se vuelve a planear; nunca se construye en el repo equivocado.

Líneas del error:

```
no está en aizencrm: reglas-features.ts
no está en aizencrm: check-features-auto-aprobar.mjs
no está en aizencrm: route.ts
```

### 2026-11-27 03:02 · 24xaj1hk Coordinador: mínimo 10 tareas trabajando a la vez; si baja, avisarle al dueño por qué — parte 1: CRM: meta editable, guardar tipo de espera y cupos, y calcular…
<!-- incidente:24xaj1hk:2026-11-27 03:02 -->

- Repo: aizencrm
- Qué falló: el plan nombra archivos que no están en este repo (repo equivocado)
- Causa: El plan nombra archivos que no están en aizencrm ni en el otro repo: reglas-coordinador-en-vivo.ts, meta-de-trabajo.ts, pausa-por-uso-de-claude.ts, check-coordinador-en-vivo.mjs
- Qué se intentó: intento 2 de 2 (antes_de_construir; se vuelve a planear)
- Cómo se resolvió: se cambió la tarjeta de repo (o se vuelve a planear) sin construir ni gastar intento
- Regla: Si el plan nombra archivos de otro repo, se cambia la tarjeta de repo y se vuelve a planear; nunca se construye en el repo equivocado.

Líneas del error:

```
no está en aizencrm: reglas-coordinador-en-vivo.ts
no está en aizencrm: meta-de-trabajo.ts
no está en aizencrm: pausa-por-uso-de-claude.ts
no está en aizencrm: check-coordinador-en-vivo.mjs
```

### 2026-11-27 04:44 · 7rlezol8 Coordinador: si una reparación falla por el mismo motivo, no repetir igual y dejar escrito por qué — parte 2: DEPENDE_DE se resuelve con git y con el estado de…
<!-- incidente:7rlezol8:2026-11-27 04:44 -->

- Repo: aizencrm
- Qué falló: Claude terminó sin cambiar ningún archivo
- Causa: Claude terminó sin cambiar ningún archivo
- Qué se intentó: intento 1 de 3 (no_cambio_nada; no cambió nada y no está en main: se reintenta con la estrategia plan_nuevo (1 de 3))
- Cómo se resolvió: se vuelve a planear la tarea
- Regla: Si Claude no cambia nada, mirar si ya está en main o volver a planear con lo que falta, sin repetir lo mismo.

Líneas del error:

```
Claude no cambió ningún archivo.
```

### 2026-11-27 05:24 · veotoze6 Bot no debe escribir en chats que ya atiende una asesora — parte 2: Frenar el aviso de pausa, la respuesta a clientes de fuera de Colombia y el recordatorio de…
<!-- incidente:veotoze6:2026-11-27 05:24 -->

- Repo: aizencrm
- Qué falló: el plan nombra archivos que no están en este repo (repo equivocado)
- Causa: El plan nombra archivos que no están en aizencrm ni en el otro repo: route.ts
- Qué se intentó: intento 1 de 2 (antes_de_construir; se vuelve a planear)
- Cómo se resolvió: se cambió la tarjeta de repo (o se vuelve a planear) sin construir ni gastar intento
- Regla: Si el plan nombra archivos de otro repo, se cambia la tarjeta de repo y se vuelve a planear; nunca se construye en el repo equivocado.

Líneas del error:

```
no está en aizencrm: route.ts
```

### 2026-11-27 05:24 · ro15uryn Listas de Chats: ordenar de más antiguo a más nuevo — parte 3: Selector "Ordenar por" en Nueva lista y lista quieta con más antiguos
<!-- incidente:ro15uryn:2026-11-27 05:24 -->

- Repo: aizencrm
- Qué falló: el plan nombra archivos que no están en este repo (repo equivocado)
- Causa: El plan nombra archivos que no están en aizencrm ni en el otro repo: page.tsx
- Qué se intentó: intento 1 de 2 (antes_de_construir; se vuelve a planear)
- Cómo se resolvió: se cambió la tarjeta de repo (o se vuelve a planear) sin construir ni gastar intento
- Regla: Si el plan nombra archivos de otro repo, se cambia la tarjeta de repo y se vuelve a planear; nunca se construye en el repo equivocado.

Líneas del error:

```
no está en aizencrm: page.tsx
```

### 2026-11-27 05:26 · ro15uryn Listas de Chats: ordenar de más antiguo a más nuevo — parte 3: Selector "Ordenar por" en Nueva lista y lista quieta con más antiguos
<!-- incidente:ro15uryn:2026-11-27 05:26 -->

- Repo: aizencrm
- Qué falló: el plan nombra archivos que no están en este repo (repo equivocado)
- Causa: El plan nombra archivos que no están en aizencrm ni en el otro repo: shared-inbox.tsx, filtros-de-bandeja-modal.tsx, page.tsx
- Qué se intentó: intento 2 de 2 (antes_de_construir; se vuelve a planear)
- Cómo se resolvió: se cambió la tarjeta de repo (o se vuelve a planear) sin construir ni gastar intento
- Regla: Si el plan nombra archivos de otro repo, se cambia la tarjeta de repo y se vuelve a planear; nunca se construye en el repo equivocado.

Líneas del error:

```
no está en aizencrm: shared-inbox.tsx
no está en aizencrm: filtros-de-bandeja-modal.tsx
no está en aizencrm: page.tsx
```

### 2026-11-27 05:49 · wgf3ekkl Coordinador: detectar tarjetas repetidas antes de planear — parte 2: Coordinador: módulo repetidas.mjs (comparación y decisión), cliente del CRM y recogida que…
<!-- incidente:wgf3ekkl:2026-11-27 05:49 -->

- Repo: aizencrm
- Qué falló: Claude terminó sin cambiar ningún archivo
- Causa: Claude terminó sin cambiar ningún archivo
- Qué se intentó: intento 1 de 3 (no_cambio_nada; no cambió nada y no está en main: se reintenta con la estrategia plan_nuevo (1 de 3))
- Cómo se resolvió: se vuelve a planear la tarea
- Regla: Si Claude no cambia nada, mirar si ya está en main o volver a planear con lo que falta, sin repetir lo mismo.

Líneas del error:

```
Claude no cambió ningún archivo.
```

### 2026-11-27 05:57 · e22year6 Tablero IA: toda Tarea nueva cae sola en Features si nadie le pone p — parte 2: Revisión diaria que pasa a Features las Tareas aprobadas que quedaron fuera, y …
<!-- incidente:e22year6:2026-11-27 05:57 -->

- Repo: aizencrm
- Qué falló: Claude terminó sin cambiar ningún archivo
- Causa: Claude terminó sin cambiar ningún archivo
- Qué se intentó: intento 1 de 3 (no_cambio_nada; no cambió nada y no está en main: se reintenta con la estrategia plan_nuevo (1 de 3))
- Cómo se resolvió: se vuelve a planear la tarea
- Regla: Si Claude no cambia nada, mirar si ya está en main o volver a planear con lo que falta, sin repetir lo mismo.

Líneas del error:

```
Claude no cambió ningún archivo.
```

### 2026-11-27 06:01 · oq9xloob Marca Magilus, versión numérica que sube sola y versión abierta por persona en Equipo — parte 1: Regla de versión v1.0.N y número que sube solo en cada desplie…
<!-- incidente:oq9xloob:2026-11-27 06:01 -->

- Repo: aizencrm
- Qué falló: el plan nombra archivos que no están en este repo (repo equivocado)
- Causa: El plan nombra archivos que no están en aizencrm ni en el otro repo: src/lib/version-del-crm.ts, scripts/check-version-del-crm.mjs, .ts
- Qué se intentó: intento 1 de 2 (antes_de_construir; se vuelve a planear)
- Cómo se resolvió: se cambió la tarjeta de repo (o se vuelve a planear) sin construir ni gastar intento
- Regla: Si el plan nombra archivos de otro repo, se cambia la tarjeta de repo y se vuelve a planear; nunca se construye en el repo equivocado.

Líneas del error:

```
no está en aizencrm: src/lib/version-del-crm.ts
no está en aizencrm: scripts/check-version-del-crm.mjs
no está en aizencrm: .ts
```

### 2026-11-27 06:02 · e22year6 Tablero IA: toda Tarea nueva cae sola en Features si nadie le pone p — parte 2: Revisión diaria que pasa a Features las Tareas aprobadas que quedaron fuera, y …
<!-- incidente:e22year6:2026-11-27 06:02 -->

- Repo: aizencrm
- Qué falló: el plan nombra archivos que no están en este repo (repo equivocado)
- Causa: El plan nombra archivos que no están en aizencrm ni en el otro repo: sql-features.ts, tareas-a-features.ts, archivadas.ts, preparar-features.ts
- Qué se intentó: intento 1 de 2 (antes_de_construir; se vuelve a planear)
- Cómo se resolvió: se cambió la tarjeta de repo (o se vuelve a planear) sin construir ni gastar intento
- Regla: Si el plan nombra archivos de otro repo, se cambia la tarjeta de repo y se vuelve a planear; nunca se construye en el repo equivocado.

Líneas del error:

```
no está en aizencrm: sql-features.ts
no está en aizencrm: tareas-a-features.ts
no está en aizencrm: archivadas.ts
no está en aizencrm: preparar-features.ts
```

### 2026-11-27 06:05 · e22year6 Tablero IA: toda Tarea nueva cae sola en Features si nadie le pone p — parte 2: Revisión diaria que pasa a Features las Tareas aprobadas que quedaron fuera, y …
<!-- incidente:e22year6:2026-11-27 06:05 -->

- Repo: aizencrm
- Qué falló: el plan nombra archivos que no están en este repo (repo equivocado)
- Causa: El plan nombra archivos que no están en aizencrm ni en el otro repo: sql-features.ts, tareas-a-features.ts, archivadas.ts, follows/route.ts, asfgbq9d.md y 3 más
- Qué se intentó: intento 2 de 2 (antes_de_construir; se vuelve a planear)
- Cómo se resolvió: se cambió la tarjeta de repo (o se vuelve a planear) sin construir ni gastar intento
- Regla: Si el plan nombra archivos de otro repo, se cambia la tarjeta de repo y se vuelve a planear; nunca se construye en el repo equivocado.

Líneas del error:

```
no está en aizencrm: sql-features.ts
no está en aizencrm: tareas-a-features.ts
no está en aizencrm: archivadas.ts
no está en aizencrm: follows/route.ts
no está en aizencrm: asfgbq9d.md
no está en aizencrm: check-tareas-a-features.mjs
no está en aizencrm: que-es-esta-aplicacion.ts
no está en aizencrm: preparar-features.ts
```

### 2026-11-27 07:38 · fd5g6qv5 Coordinador: mínimo 10 tareas trabajando a la vez; si baja, avisarle al dueño por qué — parte 2: Coordinador: mandar el tipo de cada espera, la tarjeta con la …
<!-- incidente:fd5g6qv5:2026-11-27 07:38 -->

- Repo: aizencrm
- Qué falló: el plan nombra archivos que no están en este repo (repo equivocado)
- Causa: El plan nombra archivos que no están en aizencrm ni en el otro repo: config.local.json, config.example.json
- Qué se intentó: intento 1 de 2 (antes_de_construir; se vuelve a planear)
- Cómo se resolvió: se cambió la tarjeta de repo (o se vuelve a planear) sin construir ni gastar intento
- Regla: Si el plan nombra archivos de otro repo, se cambia la tarjeta de repo y se vuelve a planear; nunca se construye en el repo equivocado.

Líneas del error:

```
no está en aizencrm: config.local.json
no está en aizencrm: config.example.json
```

### 2026-11-27 07:38 · veotoze6 Bot no debe escribir en chats que ya atiende una asesora — parte 2: Frenar el aviso de pausa, la respuesta a clientes de fuera de Colombia y el recordatorio de…
<!-- incidente:veotoze6:2026-11-27 07:38 -->

- Repo: aizencrm
- Qué falló: el plan nombra archivos que no están en este repo (repo equivocado)
- Causa: El plan nombra archivos que no están en aizencrm ni en el otro repo: route.ts, seguimientos.ts
- Qué se intentó: intento 2 de 2 (antes_de_construir; se vuelve a planear)
- Cómo se resolvió: se cambió la tarjeta de repo (o se vuelve a planear) sin construir ni gastar intento
- Regla: Si el plan nombra archivos de otro repo, se cambia la tarjeta de repo y se vuelve a planear; nunca se construye en el repo equivocado.

Líneas del error:

```
no está en aizencrm: route.ts
no está en aizencrm: seguimientos.ts
```

### 2026-11-27 07:38 · oq9xloob Marca Magilus, versión numérica que sube sola y versión abierta por persona en Equipo — parte 1: Regla de versión v1.0.N y número que sube solo en cada desplie…
<!-- incidente:oq9xloob:2026-11-27 07:38 -->

- Repo: aizencrm
- Qué falló: el plan nombra archivos que no están en este repo (repo equivocado)
- Causa: El plan nombra archivos que no están en aizencrm ni en el otro repo: .ts, app-version-guard.tsx
- Qué se intentó: intento 2 de 2 (antes_de_construir; se vuelve a planear)
- Cómo se resolvió: se cambió la tarjeta de repo (o se vuelve a planear) sin construir ni gastar intento
- Regla: Si el plan nombra archivos de otro repo, se cambia la tarjeta de repo y se vuelve a planear; nunca se construye en el repo equivocado.

Líneas del error:

```
no está en aizencrm: .ts
no está en aizencrm: app-version-guard.tsx
```

### 2026-11-27 07:38 · wgf3ekkl Coordinador: detectar tarjetas repetidas antes de planear — parte 2: Coordinador: módulo repetidas.mjs (comparación y decisión), cliente del CRM y recogida que…
<!-- incidente:wgf3ekkl:2026-11-27 07:38 -->

- Repo: aizencrm
- Qué falló: el plan nombra archivos que no están en este repo (repo equivocado)
- Causa: El plan nombra archivos que no están en aizencrm ni en el otro repo: config.mjs, bucle.mjs
- Qué se intentó: intento 1 de 2 (antes_de_construir; se vuelve a planear)
- Cómo se resolvió: se cambió la tarjeta de repo (o se vuelve a planear) sin construir ni gastar intento
- Regla: Si el plan nombra archivos de otro repo, se cambia la tarjeta de repo y se vuelve a planear; nunca se construye en el repo equivocado.

Líneas del error:

```
no está en aizencrm: config.mjs
no está en aizencrm: bucle.mjs
```

### 2026-11-27 08:11 · fd5g6qv5 Coordinador: mínimo 10 tareas trabajando a la vez; si baja, avisarle al dueño por qué — parte 2: Coordinador: mandar el tipo de cada espera, la tarjeta con la …
<!-- incidente:fd5g6qv5:2026-11-27 08:11 -->

- Repo: aizencrm
- Qué falló: el plan nombra archivos que no están en este repo (repo equivocado)
- Causa: El plan nombra archivos que no están en aizencrm ni en el otro repo: coordinador-en-vivo.ts, bucle.mjs, probar-trabajador.mjs, check-coordinador-en-vivo.mjs, config.local.json y 1 más
- Qué se intentó: intento 2 de 2 (antes_de_construir; se vuelve a planear)
- Cómo se resolvió: se cambió la tarjeta de repo (o se vuelve a planear) sin construir ni gastar intento
- Regla: Si el plan nombra archivos de otro repo, se cambia la tarjeta de repo y se vuelve a planear; nunca se construye en el repo equivocado.

Líneas del error:

```
no está en aizencrm: coordinador-en-vivo.ts
no está en aizencrm: bucle.mjs
no está en aizencrm: probar-trabajador.mjs
no está en aizencrm: check-coordinador-en-vivo.mjs
no está en aizencrm: config.local.json
no está en aizencrm: config.example.json
```

### 2026-11-27 08:13 · ohqv24rx Ajuste a T-1009: solo mover a Features lo que es desarrollo y respetar el área pedida
<!-- incidente:ohqv24rx:2026-11-27 08:13 -->

- Repo: aizencrm
- Qué falló: el plan nombra archivos que no están en este repo (repo equivocado)
- Causa: El plan nombra archivos que no están en aizencrm ni en el otro repo: reglas-features.ts, repo-por-el-texto.ts
- Qué se intentó: intento 1 de 2 (antes_de_construir; se vuelve a planear)
- Cómo se resolvió: se cambió la tarjeta de repo (o se vuelve a planear) sin construir ni gastar intento
- Regla: Si el plan nombra archivos de otro repo, se cambia la tarjeta de repo y se vuelve a planear; nunca se construye en el repo equivocado.

Líneas del error:

```
no está en aizencrm: reglas-features.ts
no está en aizencrm: repo-por-el-texto.ts
```

### 2026-11-27 08:58 · 6770303p Coordinador: mínimo 10 tareas trabajando a la vez; si baja, avisarle al dueño por qué — parte 3: Aviso al dueño, panel 'Trabajando X de 10' y ver_coordinador
<!-- incidente:6770303p:2026-11-27 08:58 -->

- Repo: aizencrm
- Qué falló: el plan nombra archivos que no están en este repo (repo equivocado)
- Causa: El plan nombra archivos que no están en aizencrm ni en el otro repo: meta-de-trabajo.ts
- Qué se intentó: intento 1 de 2 (antes_de_construir; se vuelve a planear)
- Cómo se resolvió: se cambió la tarjeta de repo (o se vuelve a planear) sin construir ni gastar intento
- Regla: Si el plan nombra archivos de otro repo, se cambia la tarjeta de repo y se vuelve a planear; nunca se construye en el repo equivocado.

Líneas del error:

```
no está en aizencrm: meta-de-trabajo.ts
```

### 2026-11-27 09:01 · 6770303p Coordinador: mínimo 10 tareas trabajando a la vez; si baja, avisarle al dueño por qué — parte 3: Aviso al dueño, panel 'Trabajando X de 10' y ver_coordinador
<!-- incidente:6770303p:2026-11-27 09:01 -->

- Repo: aizencrm
- Qué falló: el plan nombra archivos que no están en este repo (repo equivocado)
- Causa: El plan nombra archivos que no están en aizencrm ni en el otro repo: meta-de-trabajo.ts, coordinador-en-vivo.ts, avisos-al-dueno.ts, CoordinadorEnVivo.tsx, tableros-inteligentes-actions.ts y 2 más
- Qué se intentó: intento 2 de 2 (antes_de_construir; se vuelve a planear)
- Cómo se resolvió: se cambió la tarjeta de repo (o se vuelve a planear) sin construir ni gastar intento
- Regla: Si el plan nombra archivos de otro repo, se cambia la tarjeta de repo y se vuelve a planear; nunca se construye en el repo equivocado.

Líneas del error:

```
no está en aizencrm: meta-de-trabajo.ts
no está en aizencrm: coordinador-en-vivo.ts
no está en aizencrm: avisos-al-dueno.ts
no está en aizencrm: CoordinadorEnVivo.tsx
no está en aizencrm: tableros-inteligentes-actions.ts
no está en aizencrm: que-es-esta-aplicacion.ts
no está en aizencrm: check-coordinador-en-vivo.mjs
```

### 2026-11-27 09:35 · ohqv24rx Ajuste a T-1009: solo mover a Features lo que es desarrollo y respetar el área pedida
<!-- incidente:ohqv24rx:2026-11-27 09:35 -->

- Repo: aizencrm
- Qué falló: el plan nombra archivos que no están en este repo (repo equivocado)
- Causa: El plan nombra archivos que no están en aizencrm ni en el otro repo: reglas-features.ts, tableros.ts, sql-features.ts, tareas-a-features.ts, tableros-inteligentes.ts y 3 más
- Qué se intentó: intento 2 de 2 (antes_de_construir; se vuelve a planear)
- Cómo se resolvió: se cambió la tarjeta de repo (o se vuelve a planear) sin construir ni gastar intento
- Regla: Si el plan nombra archivos de otro repo, se cambia la tarjeta de repo y se vuelve a planear; nunca se construye en el repo equivocado.

Líneas del error:

```
no está en aizencrm: reglas-features.ts
no está en aizencrm: tableros.ts
no está en aizencrm: sql-features.ts
no está en aizencrm: tareas-a-features.ts
no está en aizencrm: tableros-inteligentes.ts
no está en aizencrm: route.ts
no está en aizencrm: check-tareas-a-features.mjs
no está en aizencrm: repo-por-el-texto.ts
```

### 2026-11-27 09:38 · 5dwhdw67 Ajuste a T-1009: solo mover a Features lo que es desarrollo y respetar el área pedida — parte 1: Crear tarjeta: solo las Tareas con repo van a Features, conser…
<!-- incidente:5dwhdw67:2026-11-27 09:38 -->

- Repo: aizencrm
- Qué falló: el plan nombra archivos que no están en este repo (repo equivocado)
- Causa: El plan nombra archivos que no están en aizencrm ni en el otro repo: route.ts
- Qué se intentó: intento 1 de 2 (antes_de_construir; se vuelve a planear)
- Cómo se resolvió: se cambió la tarjeta de repo (o se vuelve a planear) sin construir ni gastar intento
- Regla: Si el plan nombra archivos de otro repo, se cambia la tarjeta de repo y se vuelve a planear; nunca se construye en el repo equivocado.

Líneas del error:

```
no está en aizencrm: route.ts
```

### 2026-11-27 10:13 · oq9xloob Marca Magilus, versión numérica que sube sola y versión abierta por persona en Equipo — parte 1: Regla de versión v1.0.N y número que sube solo en cada desplie…
<!-- incidente:oq9xloob:2026-11-27 10:13 -->

- Repo: aizencrm
- Qué falló: Claude terminó sin cambiar ningún archivo
- Causa: Claude terminó sin cambiar ningún archivo
- Qué se intentó: intento 1 de 3 (no_cambio_nada; no cambió nada y no está en main: se reintenta con la estrategia plan_nuevo (1 de 3))
- Cómo se resolvió: se vuelve a planear la tarea
- Regla: Si Claude no cambia nada, mirar si ya está en main o volver a planear con lo que falta, sin repetir lo mismo.

Líneas del error:

```
Claude no cambió ningún archivo.
```

### 2026-11-27 10:13 · wzzl8ejw Bot no debe escribir en chats que ya atiende una asesora — parte 3: Reporte de mensajes automáticos en chats de asesora y nota para el manual
<!-- incidente:wzzl8ejw:2026-11-27 10:13 -->

- Repo: aizencrm
- Qué falló: Claude terminó sin cambiar ningún archivo
- Causa: Claude terminó sin cambiar ningún archivo
- Qué se intentó: intento 1 de 3 (no_cambio_nada; no cambió nada y no está en main: se reintenta con la estrategia plan_nuevo (1 de 3))
- Cómo se resolvió: se vuelve a planear la tarea
- Regla: Si Claude no cambia nada, mirar si ya está en main o volver a planear con lo que falta, sin repetir lo mismo.

Líneas del error:

```
Claude no cambió ningún archivo.
```

### 2026-11-27 11:27 · 5dwhdw67 Ajuste a T-1009: solo mover a Features lo que es desarrollo y respetar el área pedida — parte 1: Crear tarjeta: solo las Tareas con repo van a Features, conser…
<!-- incidente:5dwhdw67:2026-11-27 11:27 -->

- Repo: aizencrm
- Qué falló: el plan nombra archivos que no están en este repo (repo equivocado)
- Causa: El plan nombra archivos que no están en aizencrm ni en el otro repo: route.ts, que-es-esta-aplicacion.ts, reglas-features.ts, reglas-trabajador.ts, tableros.ts y 2 más
- Qué se intentó: intento 2 de 2 (antes_de_construir; se vuelve a planear)
- Cómo se resolvió: se cambió la tarjeta de repo (o se vuelve a planear) sin construir ni gastar intento
- Regla: Si el plan nombra archivos de otro repo, se cambia la tarjeta de repo y se vuelve a planear; nunca se construye en el repo equivocado.

Líneas del error:

```
no está en aizencrm: route.ts
no está en aizencrm: que-es-esta-aplicacion.ts
no está en aizencrm: reglas-features.ts
no está en aizencrm: reglas-trabajador.ts
no está en aizencrm: tableros.ts
no está en aizencrm: sql-features.ts
no está en aizencrm: tareas-a-features.ts
```

### 2026-11-27 11:28 · 1mfe2om2 Coordinador: revisar repo y "ya está en main" antes de planear; contestar preguntas de la nube solo — parte 2: Coordinador: repo correcto antes de planear
<!-- incidente:1mfe2om2:2026-11-27 11:28 -->

- Repo: aizencrm
- Qué falló: el plan nombra archivos que no están en este repo (repo equivocado)
- Causa: El plan nombra archivos que no están en aizencrm ni en el otro repo: crm.mjs, route.ts, reglas-trabajador.ts, choques.mjs, etapas.mjs y 2 más
- Qué se intentó: intento 1 de 2 (antes_de_construir; se vuelve a planear)
- Cómo se resolvió: se cambió la tarjeta de repo (o se vuelve a planear) sin construir ni gastar intento
- Regla: Si el plan nombra archivos de otro repo, se cambia la tarjeta de repo y se vuelve a planear; nunca se construye en el repo equivocado.

Líneas del error:

```
no está en aizencrm: crm.mjs
no está en aizencrm: route.ts
no está en aizencrm: reglas-trabajador.ts
no está en aizencrm: choques.mjs
no está en aizencrm: etapas.mjs
no está en aizencrm: probar-repo-correcto.mjs
no está en aizencrm: bucle.mjs
```

### 2026-11-27 11:28 · wgf3ekkl Coordinador: detectar tarjetas repetidas antes de planear — parte 2: Coordinador: módulo repetidas.mjs (comparación y decisión), cliente del CRM y recogida que…
<!-- incidente:wgf3ekkl:2026-11-27 11:28 -->

- Repo: aizencrm
- Qué falló: el plan nombra archivos que no están en este repo (repo equivocado)
- Causa: El plan nombra archivos que no están en aizencrm ni en el otro repo: choques.mjs, src/a.ts, bucle.mjs, etapas.mjs
- Qué se intentó: intento 2 de 2 (antes_de_construir; se vuelve a planear)
- Cómo se resolvió: se cambió la tarjeta de repo (o se vuelve a planear) sin construir ni gastar intento
- Regla: Si el plan nombra archivos de otro repo, se cambia la tarjeta de repo y se vuelve a planear; nunca se construye en el repo equivocado.

Líneas del error:

```
no está en aizencrm: choques.mjs
no está en aizencrm: src/a.ts
no está en aizencrm: bucle.mjs
no está en aizencrm: etapas.mjs
```

### 2026-11-27 11:28 · 1hcjbu1v Coordinador: si una reparación falla por el mismo motivo, no repetir igual y dejar escrito por qué — parte 3: Misma causa no se repara igual, y cada reparación…
<!-- incidente:1hcjbu1v:2026-11-27 11:28 -->

- Repo: aizencrm
- Qué falló: el plan nombra archivos que no están en este repo (repo equivocado)
- Causa: El plan nombra archivos que no están en aizencrm ni en el otro repo: bucle.mjs, diagnostico.mjs, reglas-trabajador.ts, bitacora.mjs, trabajador.ts y 3 más
- Qué se intentó: intento 1 de 2 (antes_de_construir; se vuelve a planear)
- Cómo se resolvió: se cambió la tarjeta de repo (o se vuelve a planear) sin construir ni gastar intento
- Regla: Si el plan nombra archivos de otro repo, se cambia la tarjeta de repo y se vuelve a planear; nunca se construye en el repo equivocado.

Líneas del error:

```
no está en aizencrm: bucle.mjs
no está en aizencrm: diagnostico.mjs
no está en aizencrm: reglas-trabajador.ts
no está en aizencrm: bitacora.mjs
no está en aizencrm: trabajador.ts
no está en aizencrm: probar-fallas-repetidas.mjs
no está en aizencrm: probar-bitacora.mjs
no está en aizencrm: check-tableros-reglas.mjs
```

### 2026-11-27 11:33 · 1hcjbu1v Coordinador: si una reparación falla por el mismo motivo, no repetir igual y dejar escrito por qué — parte 3: Misma causa no se repara igual, y cada reparación…
<!-- incidente:1hcjbu1v:2026-11-27 11:33 -->

- Repo: aizencrm
- Qué falló: el plan nombra archivos que no están en este repo (repo equivocado)
- Causa: El plan nombra archivos que no están en aizencrm ni en el otro repo: diagnostico.mjs, bucle.mjs, medir.mjs, bitacora.mjs, probar-fallas-repetidas.mjs y 5 más
- Qué se intentó: intento 2 de 2 (antes_de_construir; se vuelve a planear)
- Cómo se resolvió: se cambió la tarjeta de repo (o se vuelve a planear) sin construir ni gastar intento
- Regla: Si el plan nombra archivos de otro repo, se cambia la tarjeta de repo y se vuelve a planear; nunca se construye en el repo equivocado.

Líneas del error:

```
no está en aizencrm: diagnostico.mjs
no está en aizencrm: bucle.mjs
no está en aizencrm: medir.mjs
no está en aizencrm: bitacora.mjs
no está en aizencrm: probar-fallas-repetidas.mjs
no está en aizencrm: probar-trabajador.mjs
no está en aizencrm: probar-bitacora.mjs
no está en aizencrm: reglas-trabajador.ts
```

### 2026-11-27 12:10 · wvl6ijpz Agente V3: mensaje de respaldo cuando la IA no logra redactar — parte 2: El motor del V3 sabe mandar un respaldo (todavía sin conectar)
<!-- incidente:wvl6ijpz:2026-11-27 12:10 -->

- Repo: aizencrm
- Qué falló: el plan nombra archivos que no están en este repo (repo equivocado)
- Causa: El plan nombra archivos que no están en aizencrm ni en el otro repo: src/features/agente-v3/motor/respaldo.ts, src/features/agente-v3/motor/respaldo.test.ts
- Qué se intentó: intento 1 de 2 (antes_de_construir; se vuelve a planear)
- Cómo se resolvió: se cambió la tarjeta de repo (o se vuelve a planear) sin construir ni gastar intento
- Regla: Si el plan nombra archivos de otro repo, se cambia la tarjeta de repo y se vuelve a planear; nunca se construye en el repo equivocado.

Líneas del error:

```
no está en aizencrm: src/features/agente-v3/motor/respaldo.ts
no está en aizencrm: src/features/agente-v3/motor/respaldo.test.ts
```

### 2026-11-27 12:10 · vqrpx3p6 Marca Magilus, versión numérica que sube sola y versión abierta por persona en Equipo — parte 2: Barra lateral con logo y nombre Magilus y la versión v1.0.N
<!-- incidente:vqrpx3p6:2026-11-27 12:10 -->

- Repo: aizencrm
- Qué falló: el plan nombra archivos que no están en este repo (repo equivocado)
- Causa: El plan nombra archivos que no están en aizencrm ni en el otro repo: scripts/check-marca-magilus.mjs, app-sidebar.tsx, docker-image.yml
- Qué se intentó: intento 1 de 2 (antes_de_construir; se vuelve a planear)
- Cómo se resolvió: se cambió la tarjeta de repo (o se vuelve a planear) sin construir ni gastar intento
- Regla: Si el plan nombra archivos de otro repo, se cambia la tarjeta de repo y se vuelve a planear; nunca se construye en el repo equivocado.

Líneas del error:

```
no está en aizencrm: scripts/check-marca-magilus.mjs
no está en aizencrm: app-sidebar.tsx
no está en aizencrm: docker-image.yml
```

### 2026-11-27 12:11 · wzzl8ejw Bot no debe escribir en chats que ya atiende una asesora — parte 3: Reporte de mensajes automáticos en chats de asesora y nota para el manual
<!-- incidente:wzzl8ejw:2026-11-27 12:11 -->

- Repo: aizencrm
- Qué falló: el plan nombra archivos que no están en este repo (repo equivocado)
- Causa: El plan nombra archivos que no están en aizencrm ni en el otro repo: .mjs, reporte-reparto-leads.mjs
- Qué se intentó: intento 1 de 2 (antes_de_construir; se vuelve a planear)
- Cómo se resolvió: se cambió la tarjeta de repo (o se vuelve a planear) sin construir ni gastar intento
- Regla: Si el plan nombra archivos de otro repo, se cambia la tarjeta de repo y se vuelve a planear; nunca se construye en el repo equivocado.

Líneas del error:

```
no está en aizencrm: .mjs
no está en aizencrm: reporte-reparto-leads.mjs
```

### 2026-11-27 12:55 · 95akb4my Marca Magilus, versión numérica que sube sola y versión abierta por persona en Equipo — parte 3: Equipo muestra qué versión tiene abierta cada persona
<!-- incidente:95akb4my:2026-11-27 12:55 -->

- Repo: aizencrm
- Qué falló: el plan nombra archivos que no están en este repo (repo equivocado)
- Causa: El plan nombra archivos que no están en aizencrm ni en el otro repo: page.tsx, latido-de-actividad.tsx, route.ts, ultima-accion-del-equipo.tsx
- Qué se intentó: intento 1 de 2 (antes_de_construir; se vuelve a planear)
- Cómo se resolvió: se cambió la tarjeta de repo (o se vuelve a planear) sin construir ni gastar intento
- Regla: Si el plan nombra archivos de otro repo, se cambia la tarjeta de repo y se vuelve a planear; nunca se construye en el repo equivocado.

Líneas del error:

```
no está en aizencrm: page.tsx
no está en aizencrm: latido-de-actividad.tsx
no está en aizencrm: route.ts
no está en aizencrm: ultima-accion-del-equipo.tsx
```

### 2026-11-27 13:22 · 95akb4my Marca Magilus, versión numérica que sube sola y versión abierta por persona en Equipo — parte 3: Equipo muestra qué versión tiene abierta cada persona
<!-- incidente:95akb4my:2026-11-27 13:22 -->

- Repo: aizencrm
- Qué falló: el plan nombra archivos que no están en este repo (repo equivocado)
- Causa: El plan nombra archivos que no están en aizencrm ni en el otro repo: page.tsx, route.ts, latido-de-actividad.tsx, actividad-del-equipo.ts, ultima-accion-del-equipo.tsx y 1 más
- Qué se intentó: intento 2 de 2 (antes_de_construir; se vuelve a planear)
- Cómo se resolvió: se cambió la tarjeta de repo (o se vuelve a planear) sin construir ni gastar intento
- Regla: Si el plan nombra archivos de otro repo, se cambia la tarjeta de repo y se vuelve a planear; nunca se construye en el repo equivocado.

Líneas del error:

```
no está en aizencrm: page.tsx
no está en aizencrm: route.ts
no está en aizencrm: latido-de-actividad.tsx
no está en aizencrm: actividad-del-equipo.ts
no está en aizencrm: ultima-accion-del-equipo.tsx
no está en aizencrm: check-version-del-crm.mjs
```

### 2026-11-27 13:57 · qt8z1y9f Ajuste a T-1009: solo mover a Features lo que es desarrollo y respetar el área pedi — parte 2: Barrido diario: solo Tareas aprobadas con repo gestion/aizencrm,…
<!-- incidente:qt8z1y9f:2026-11-27 13:57 -->

- Repo: aizencrm
- Qué falló: el plan nombra archivos que no están en este repo (repo equivocado)
- Causa: El plan nombra archivos que no están en aizencrm ni en el otro repo: reglas-features.ts
- Qué se intentó: intento 1 de 2 (antes_de_construir; se vuelve a planear)
- Cómo se resolvió: se cambió la tarjeta de repo (o se vuelve a planear) sin construir ni gastar intento
- Regla: Si el plan nombra archivos de otro repo, se cambia la tarjeta de repo y se vuelve a planear; nunca se construye en el repo equivocado.

Líneas del error:

```
no está en aizencrm: reglas-features.ts
```

### 2026-11-27 13:58 · jrjcwn8h Agente V3: mensaje de respaldo cuando la IA no logra redactar — parte 2: El mo — parte 1: Agente V3: el motor manda el respaldo cuando ninguna regla aplica o l…
<!-- incidente:jrjcwn8h:2026-11-27 13:58 -->

- Repo: aizencrm
- Qué falló: el plan nombra archivos que no están en este repo (repo equivocado)
- Causa: El plan nombra archivos que no están en aizencrm ni en el otro repo: retomar.ts, ejecutar.ts
- Qué se intentó: intento 1 de 2 (antes_de_construir; se vuelve a planear)
- Cómo se resolvió: se cambió la tarjeta de repo (o se vuelve a planear) sin construir ni gastar intento
- Regla: Si el plan nombra archivos de otro repo, se cambia la tarjeta de repo y se vuelve a planear; nunca se construye en el repo equivocado.

Líneas del error:

```
no está en aizencrm: retomar.ts
no está en aizencrm: ejecutar.ts
```

### 2026-11-27 14:35 · 4ctwaip5 Tablero IA: vista tipo tablero (columnas por estado) de lo que cuelga de Features — parte 2: Botón "Features" en el inicio del Tablero IA y vista tipo tablero …
<!-- incidente:4ctwaip5:2026-11-27 14:35 -->

- Repo: aizencrm
- Qué falló: el plan nombra archivos que no están en este repo (repo equivocado)
- Causa: El plan nombra archivos que no están en aizencrm ni en el otro repo: VistaKanban.tsx, src/features/tableros-inteligentes/components/VistaDeFeatures.tsx, components/colores.ts, VistaDeFeatures.tsx, In…
- Qué se intentó: intento 1 de 2 (antes_de_construir; se vuelve a planear)
- Cómo se resolvió: se cambió la tarjeta de repo (o se vuelve a planear) sin construir ni gastar intento
- Regla: Si el plan nombra archivos de otro repo, se cambia la tarjeta de repo y se vuelve a planear; nunca se construye en el repo equivocado.

Líneas del error:

```
no está en aizencrm: VistaKanban.tsx
no está en aizencrm: src/features/tableros-inteligentes/components/VistaDeFeatures.tsx
no está en aizencrm: components/colores.ts
no está en aizencrm: VistaDeFeatures.tsx
no está en aizencrm: InicioDeTableros.tsx
no está en aizencrm: page.tsx
```

### 2026-11-27 14:35 · jrjcwn8h Agente V3: mensaje de respaldo cuando la IA no logra redactar — parte 2: El mo — parte 1: Agente V3: el motor manda el respaldo cuando ninguna regla aplica o l…
<!-- incidente:jrjcwn8h:2026-11-27 14:35 -->

- Repo: aizencrm
- Qué falló: el plan nombra archivos que no están en este repo (repo equivocado)
- Causa: El plan nombra archivos que no están en aizencrm ni en el otro repo: retomar.ts, ejecutar.ts, respaldo.ts, check-agente-v3-respaldo.mjs, route.ts
- Qué se intentó: intento 2 de 2 (antes_de_construir; se vuelve a planear)
- Cómo se resolvió: se cambió la tarjeta de repo (o se vuelve a planear) sin construir ni gastar intento
- Regla: Si el plan nombra archivos de otro repo, se cambia la tarjeta de repo y se vuelve a planear; nunca se construye en el repo equivocado.

Líneas del error:

```
no está en aizencrm: retomar.ts
no está en aizencrm: ejecutar.ts
no está en aizencrm: respaldo.ts
no está en aizencrm: check-agente-v3-respaldo.mjs
no está en aizencrm: route.ts
```

### 2026-11-27 14:55 · pfs9c27o Coordinador: planear con Opus y construir con Sonnet — parte 2: Nube: forzar el modelo en la sesión fija y que la sesión diga cuál usó
<!-- incidente:pfs9c27o:2026-11-27 14:55 -->

- Repo: aizencrm
- Qué falló: la sesión de la nube no dio señal ni dejó su resultado
- Causa: nube_sin_resultado: La sesión de la nube no dio señal (ni el commit "inicio:" ni ningún otro) en la rama tablero/pfsNcNo-coordinador-planear-con-opus-y-construi…
- Qué cambia: la nube no dio señal: se abre una sesión nueva de la nube (nunca la de un intento anterior)
- Por qué es distinto: se prueba la estrategia sesion_nueva, que no se había usado con esta causa
- Qué se intentó: intento 1 de 3 (nube_sin_resultado; la nube no dio señal: se reintenta con la estrategia sesion_nueva (1 de 3))
- Cómo se resolvió: reintento en una sesión nueva de la nube (nunca la de un intento anterior)
- Regla: Si la nube no da señal, se reintenta en una sesión nueva; nunca en la misma sesión de un intento anterior.

Líneas del error:

```
La sesión de la nube no dio señal (ni el commit "inicio:" ni ningún otro) en la rama tablero/pfs9c27o-coordinador-planear-con-opus-y-construir en 20 min: se cortó la espera. Mírala: https://claude.ai/code/session_01XuE6Fa3RRZGxmEkdcsm2oX
```

### 2026-11-27 14:55 · 4ctwaip5 Tablero IA: vista tipo tablero (columnas por estado) de lo que cuelga de Features — parte 2: Botón "Features" en el inicio del Tablero IA y vista tipo tablero …
<!-- incidente:4ctwaip5:2026-11-27 14:55 -->

- Repo: aizencrm
- Qué falló: el plan nombra archivos que no están en este repo (repo equivocado)
- Causa: El plan nombra archivos que no están en aizencrm ni en el otro repo: VistaDeFeatures.tsx, hooks/useRefrescoDelTablero.ts, components/colores.ts, InicioDeTableros.tsx, page.tsx y 2 más
- Qué se intentó: intento 2 de 2 (antes_de_construir; se vuelve a planear)
- Cómo se resolvió: se cambió la tarjeta de repo (o se vuelve a planear) sin construir ni gastar intento
- Regla: Si el plan nombra archivos de otro repo, se cambia la tarjeta de repo y se vuelve a planear; nunca se construye en el repo equivocado.

Líneas del error:

```
no está en aizencrm: VistaDeFeatures.tsx
no está en aizencrm: hooks/useRefrescoDelTablero.ts
no está en aizencrm: components/colores.ts
no está en aizencrm: InicioDeTableros.tsx
no está en aizencrm: page.tsx
no está en aizencrm: check-tablero-features-kanban.mjs
no está en aizencrm: VistaKanban.tsx
```

### 2026-11-27 15:35 · qt8z1y9f Ajuste a T-1009: solo mover a Features lo que es desarrollo y respetar el área pedi — parte 2: Barrido diario: solo Tareas aprobadas con repo gestion/aizencrm,…
<!-- incidente:qt8z1y9f:2026-11-27 15:35 -->

- Repo: aizencrm
- Qué falló: el plan nombra archivos que no están en este repo (repo equivocado)
- Causa: El plan nombra archivos que no están en aizencrm ni en el otro repo: reglas-features.ts, sql-features.ts, tareas-a-features.ts, que-es-esta-aplicacion.ts, asfgbq9d.md
- Qué se intentó: intento 2 de 2 (antes_de_construir; se vuelve a planear)
- Cómo se resolvió: se cambió la tarjeta de repo (o se vuelve a planear) sin construir ni gastar intento
- Regla: Si el plan nombra archivos de otro repo, se cambia la tarjeta de repo y se vuelve a planear; nunca se construye en el repo equivocado.

Líneas del error:

```
no está en aizencrm: reglas-features.ts
no está en aizencrm: sql-features.ts
no está en aizencrm: tareas-a-features.ts
no está en aizencrm: que-es-esta-aplicacion.ts
no está en aizencrm: asfgbq9d.md
```

### 2026-11-27 15:35 · 5195ft6s Coordinador: si una reparación falla por el mismo motivo, no repetir igual y dejar escrito por qué — parte 4: Alerta MEDIA en el panel cuando una tarjeta lleva…
<!-- incidente:5195ft6s:2026-11-27 15:35 -->

- Repo: aizencrm
- Qué falló: el plan nombra archivos que no están en este repo (repo equivocado)
- Causa: El plan nombra archivos que no están en aizencrm ni en el otro repo: latido.mjs, reglas-coordinador-en-vivo.ts, coordinador-en-vivo.ts, etapas.mjs
- Qué se intentó: intento 1 de 2 (antes_de_construir; se vuelve a planear)
- Cómo se resolvió: se cambió la tarjeta de repo (o se vuelve a planear) sin construir ni gastar intento
- Regla: Si el plan nombra archivos de otro repo, se cambia la tarjeta de repo y se vuelve a planear; nunca se construye en el repo equivocado.

Líneas del error:

```
no está en aizencrm: latido.mjs
no está en aizencrm: reglas-coordinador-en-vivo.ts
no está en aizencrm: coordinador-en-vivo.ts
no está en aizencrm: etapas.mjs
```

### 2026-11-27 15:43 · qv5c8e0d Agente V3: mensaje de respaldo cuando la IA no logra redactar — parte 2: El motor de — parte 2: Agente V3: el respaldo también sale desde la acción responder_c…
<!-- incidente:qv5c8e0d:2026-11-27 15:43 -->

- Repo: aizencrm
- Qué falló: el plan nombra archivos que no están en este repo (repo equivocado)
- Causa: El plan nombra archivos que no están en aizencrm ni en el otro repo: retomar.ts
- Qué se intentó: intento 1 de 2 (antes_de_construir; se vuelve a planear)
- Cómo se resolvió: se cambió la tarjeta de repo (o se vuelve a planear) sin construir ni gastar intento
- Regla: Si el plan nombra archivos de otro repo, se cambia la tarjeta de repo y se vuelve a planear; nunca se construye en el repo equivocado.

Líneas del error:

```
no está en aizencrm: retomar.ts
```

### 2026-11-27 15:45 · qv5c8e0d Agente V3: mensaje de respaldo cuando la IA no logra redactar — parte 2: El motor de — parte 2: Agente V3: el respaldo también sale desde la acción responder_c…
<!-- incidente:qv5c8e0d:2026-11-27 15:45 -->

- Repo: aizencrm
- Qué falló: el plan nombra archivos que no están en este repo (repo equivocado)
- Causa: El plan nombra archivos que no están en aizencrm ni en el otro repo: ejecutar.ts, respaldo.ts, route.ts, retomar.ts, producto-del-mensaje.test.ts y 2 más
- Qué se intentó: intento 2 de 2 (antes_de_construir; se vuelve a planear)
- Cómo se resolvió: se cambió la tarjeta de repo (o se vuelve a planear) sin construir ni gastar intento
- Regla: Si el plan nombra archivos de otro repo, se cambia la tarjeta de repo y se vuelve a planear; nunca se construye en el repo equivocado.

Líneas del error:

```
no está en aizencrm: ejecutar.ts
no está en aizencrm: respaldo.ts
no está en aizencrm: route.ts
no está en aizencrm: retomar.ts
no está en aizencrm: producto-del-mensaje.test.ts
no está en aizencrm: check-agente-v3-respaldo.mjs
no está en aizencrm: decidir.ts
```

### 2026-11-27 16:52 · v95nuxvm Tablero IA: vista tipo tablero (columnas por estado) de lo que cuelga de Features — parte 3: "Ver como tablero" en el mapa al estar en el nivel de Features (al…
<!-- incidente:v95nuxvm:2026-11-27 16:52 -->

- Repo: aizencrm
- Qué falló: el plan nombra archivos que no están en este repo (repo equivocado)
- Causa: El plan nombra archivos que no están en aizencrm ni en el otro repo: TablerosInteligentesVista.tsx, page.tsx
- Qué se intentó: intento 1 de 2 (antes_de_construir; se vuelve a planear)
- Cómo se resolvió: se cambió la tarjeta de repo (o se vuelve a planear) sin construir ni gastar intento
- Regla: Si el plan nombra archivos de otro repo, se cambia la tarjeta de repo y se vuelve a planear; nunca se construye en el repo equivocado.

Líneas del error:

```
no está en aizencrm: TablerosInteligentesVista.tsx
no está en aizencrm: page.tsx
```

### 2026-11-27 16:53 · 5195ft6s Coordinador: si una reparación falla por el mismo motivo, no repetir igual y dejar escrito por qué — parte 4: Alerta MEDIA en el panel cuando una tarjeta lleva…
<!-- incidente:5195ft6s:2026-11-27 16:53 -->

- Repo: aizencrm
- Qué falló: el plan nombra archivos que no están en este repo (repo equivocado)
- Causa: El plan nombra archivos que no están en aizencrm ni en el otro repo: etapas.mjs, bucle.mjs, probar-trabajador.mjs, reglas-coordinador-en-vivo.ts, coordinador-en-vivo.ts y 1 más
- Qué se intentó: intento 2 de 2 (antes_de_construir; se vuelve a planear)
- Cómo se resolvió: se cambió la tarjeta de repo (o se vuelve a planear) sin construir ni gastar intento
- Regla: Si el plan nombra archivos de otro repo, se cambia la tarjeta de repo y se vuelve a planear; nunca se construye en el repo equivocado.

Líneas del error:

```
no está en aizencrm: etapas.mjs
no está en aizencrm: bucle.mjs
no está en aizencrm: probar-trabajador.mjs
no está en aizencrm: reglas-coordinador-en-vivo.ts
no está en aizencrm: coordinador-en-vivo.ts
no está en aizencrm: nube.mjs
```

### 2026-11-27 17:30 · 99qbfa4m Agente V3: mensaje de respaldo cuando la IA no logra redactar — parte 3: Conectar el respaldo en el webhook y en el retomar
<!-- incidente:99qbfa4m:2026-11-27 17:30 -->

- Repo: aizencrm
- Qué falló: el plan nombra archivos que no están en este repo (repo equivocado)
- Causa: El plan nombra archivos que no están en aizencrm ni en el otro repo: .md
- Qué se intentó: intento 1 de 2 (antes_de_construir; se vuelve a planear)
- Cómo se resolvió: se cambió la tarjeta de repo (o se vuelve a planear) sin construir ni gastar intento
- Regla: Si el plan nombra archivos de otro repo, se cambia la tarjeta de repo y se vuelve a planear; nunca se construye en el repo equivocado.

Líneas del error:

```
no está en aizencrm: .md
```

### 2026-11-27 17:33 · 3mbhfr4w Agente V3: mensaje de respaldo cuando la IA no logra redactar — parte 3: Conectar el respaldo en el webhook y en el retomar — parte 1: Archivo de ayuda de fluj…
<!-- incidente:3mbhfr4w:2026-11-27 17:33 -->

- Repo: aizencrm
- Qué falló: el plan nombra archivos que no están en este repo (repo equivocado)
- Causa: El plan nombra archivos que no están en aizencrm ni en el otro repo: respaldo.ts, src/features/agente-v3/servicios/flujos-de-la-linea.ts, sugerencia-de-respuesta.ts, retomar.ts
- Qué se intentó: intento 1 de 2 (antes_de_construir; se vuelve a planear)
- Cómo se resolvió: se cambió la tarjeta de repo (o se vuelve a planear) sin construir ni gastar intento
- Regla: Si el plan nombra archivos de otro repo, se cambia la tarjeta de repo y se vuelve a planear; nunca se construye en el repo equivocado.

Líneas del error:

```
no está en aizencrm: respaldo.ts
no está en aizencrm: src/features/agente-v3/servicios/flujos-de-la-linea.ts
no está en aizencrm: sugerencia-de-respuesta.ts
no está en aizencrm: retomar.ts
```

### 2026-11-27 17:34 · 3mbhfr4w Agente V3: mensaje de respaldo cuando la IA no logra redactar — parte 3: Conectar el respaldo en el webhook y en el retomar — parte 1: Archivo de ayuda de fluj…
<!-- incidente:3mbhfr4w:2026-11-27 17:34 -->

- Repo: aizencrm
- Qué falló: el plan nombra archivos que no están en este repo (repo equivocado)
- Causa: El plan nombra archivos que no están en aizencrm ni en el otro repo: ejecutar.ts, respaldo.ts, retomar.ts, check-agente-v3-respaldo.mjs, check-rescate-mensajes.mjs y 1 más
- Qué se intentó: intento 2 de 2 (antes_de_construir; se vuelve a planear)
- Cómo se resolvió: se cambió la tarjeta de repo (o se vuelve a planear) sin construir ni gastar intento
- Regla: Si el plan nombra archivos de otro repo, se cambia la tarjeta de repo y se vuelve a planear; nunca se construye en el repo equivocado.

Líneas del error:

```
no está en aizencrm: ejecutar.ts
no está en aizencrm: respaldo.ts
no está en aizencrm: retomar.ts
no está en aizencrm: check-agente-v3-respaldo.mjs
no está en aizencrm: check-rescate-mensajes.mjs
no está en aizencrm: redactor.ts
```

### 2026-11-27 17:35 · 1mfe2om2 Coordinador: revisar repo y "ya está en main" antes de planear; contestar preguntas de la nube solo — parte 2: Coordinador: repo correcto antes de planear
<!-- incidente:1mfe2om2:2026-11-27 17:35 -->

- Repo: aizencrm
- Qué falló: el plan nombra archivos que no están en este repo (repo equivocado)
- Causa: El plan nombra archivos que no están en aizencrm ni en el otro repo: etapas.mjs, choques.mjs, probar-repo-correcto.mjs, probar-repo-equivocado.mjs, check-tableros-reglas.mjs y 1 más
- Qué se intentó: intento 2 de 2 (antes_de_construir; se vuelve a planear)
- Cómo se resolvió: se cambió la tarjeta de repo (o se vuelve a planear) sin construir ni gastar intento
- Regla: Si el plan nombra archivos de otro repo, se cambia la tarjeta de repo y se vuelve a planear; nunca se construye en el repo equivocado.

Líneas del error:

```
no está en aizencrm: etapas.mjs
no está en aizencrm: choques.mjs
no está en aizencrm: probar-repo-correcto.mjs
no está en aizencrm: probar-repo-equivocado.mjs
no está en aizencrm: check-tableros-reglas.mjs
no está en aizencrm: bucle.mjs
```

### 2026-11-27 18:57 · f8aqwgxm Agente V3: mensaje de respaldo cuando la IA no logra redactar — parte 3: Conectar el respaldo en el webhook y en el retomar — parte 2: Respaldo conectado en el…
<!-- incidente:f8aqwgxm:2026-11-27 18:57 -->

- Repo: aizencrm
- Qué falló: el plan nombra archivos que no están en este repo (repo equivocado)
- Causa: El plan nombra archivos que no están en aizencrm ni en el otro repo: retomar.ts, route.ts, check-rescate-mensajes.mjs
- Qué se intentó: intento 1 de 2 (antes_de_construir; se vuelve a planear)
- Cómo se resolvió: se cambió la tarjeta de repo (o se vuelve a planear) sin construir ni gastar intento
- Regla: Si el plan nombra archivos de otro repo, se cambia la tarjeta de repo y se vuelve a planear; nunca se construye en el repo equivocado.

Líneas del error:

```
no está en aizencrm: retomar.ts
no está en aizencrm: route.ts
no está en aizencrm: check-rescate-mensajes.mjs
```

### 2026-11-27 18:58 · f8aqwgxm Agente V3: mensaje de respaldo cuando la IA no logra redactar — parte 3: Conectar el respaldo en el webhook y en el retomar — parte 2: Respaldo conectado en el…
<!-- incidente:f8aqwgxm:2026-11-27 18:58 -->

- Repo: aizencrm
- Qué falló: el plan nombra archivos que no están en este repo (repo equivocado)
- Causa: El plan nombra archivos que no están en aizencrm ni en el otro repo: 99qbfa4m.md, f8aqwgxm.md, retomar.ts, motor/ejecutar.ts, route.ts y 1 más
- Qué se intentó: intento 2 de 2 (antes_de_construir; se vuelve a planear)
- Cómo se resolvió: se cambió la tarjeta de repo (o se vuelve a planear) sin construir ni gastar intento
- Regla: Si el plan nombra archivos de otro repo, se cambia la tarjeta de repo y se vuelve a planear; nunca se construye en el repo equivocado.

Líneas del error:

```
no está en aizencrm: 99qbfa4m.md
no está en aizencrm: f8aqwgxm.md
no está en aizencrm: retomar.ts
no está en aizencrm: motor/ejecutar.ts
no está en aizencrm: route.ts
no está en aizencrm: flujos-de-la-linea.ts
```

### 2026-11-27 19:33 · v95nuxvm Tablero IA: vista tipo tablero (columnas por estado) de lo que cuelga de Features — parte 3: "Ver como tablero" en el mapa al estar en el nivel de Features (al…
<!-- incidente:v95nuxvm:2026-11-27 19:33 -->

- Repo: aizencrm
- Qué falló: el plan nombra archivos que no están en este repo (repo equivocado)
- Causa: El plan nombra archivos que no están en aizencrm ni en el otro repo: page.tsx, TablerosInteligentesVista.tsx, VistaDeFeatures.tsx, InicioDeTableros.tsx, tablero-de-features.ts
- Qué se intentó: intento 2 de 2 (antes_de_construir; se vuelve a planear)
- Cómo se resolvió: se cambió la tarjeta de repo (o se vuelve a planear) sin construir ni gastar intento
- Regla: Si el plan nombra archivos de otro repo, se cambia la tarjeta de repo y se vuelve a planear; nunca se construye en el repo equivocado.

Líneas del error:

```
no está en aizencrm: page.tsx
no está en aizencrm: TablerosInteligentesVista.tsx
no está en aizencrm: VistaDeFeatures.tsx
no está en aizencrm: InicioDeTableros.tsx
no está en aizencrm: tablero-de-features.ts
```

### 2026-11-27 19:59 · 13a38htn Coordinador: detectar tarjetas repetidas antes de planear — parte 3: Coordinador: usar la revisión de repetidas antes de planear y dejar la nota del manual
<!-- incidente:13a38htn:2026-11-27 19:59 -->

- Repo: aizencrm
- Qué falló: el plan nombra archivos que no están en este repo (repo equivocado)
- Causa: El plan nombra archivos que no están en aizencrm ni en el otro repo: repetidas.mjs, diagnostico.mjs, claude-falso.mjs, probar-fallas-repetidas.mjs
- Qué se intentó: intento 1 de 2 (antes_de_construir; se vuelve a planear)
- Cómo se resolvió: se cambió la tarjeta de repo (o se vuelve a planear) sin construir ni gastar intento
- Regla: Si el plan nombra archivos de otro repo, se cambia la tarjeta de repo y se vuelve a planear; nunca se construye en el repo equivocado.

Líneas del error:

```
no está en aizencrm: repetidas.mjs
no está en aizencrm: diagnostico.mjs
no está en aizencrm: claude-falso.mjs
no está en aizencrm: probar-fallas-repetidas.mjs
```

### 2026-11-27 20:06 · y25hjcgg Coordinador: revisar repo y "ya está en main" antes de planear; contestar preguntas de la nube solo — parte 3: Coordinador: si ya está en main, HECHO sin const…
<!-- incidente:y25hjcgg:2026-11-27 20:06 -->

- Repo: aizencrm
- Qué falló: el plan nombra archivos que no están en este repo (repo equivocado)
- Causa: El plan nombra archivos que no están en aizencrm ni en el otro repo: lib/etapas.mjs, lib/bucle.mjs, bucle.mjs, sql-trabajador.ts, route.ts y 8 más
- Qué se intentó: intento 1 de 2 (antes_de_construir; se vuelve a planear)
- Cómo se resolvió: se cambió la tarjeta de repo (o se vuelve a planear) sin construir ni gastar intento
- Regla: Si el plan nombra archivos de otro repo, se cambia la tarjeta de repo y se vuelve a planear; nunca se construye en el repo equivocado.

Líneas del error:

```
no está en aizencrm: lib/etapas.mjs
no está en aizencrm: lib/bucle.mjs
no está en aizencrm: bucle.mjs
no está en aizencrm: sql-trabajador.ts
no está en aizencrm: route.ts
no está en aizencrm: lib/repo-correcto.mjs
no está en aizencrm: lib/diagnostico.mjs
no está en aizencrm: lib/recoger-errores.mjs
```

### 2026-11-27 20:06 · 13a38htn Coordinador: detectar tarjetas repetidas antes de planear — parte 3: Coordinador: usar la revisión de repetidas antes de planear y dejar la nota del manual
<!-- incidente:13a38htn:2026-11-27 20:06 -->

- Repo: aizencrm
- Qué falló: el plan nombra archivos que no están en este repo (repo equivocado)
- Causa: El plan nombra archivos que no están en aizencrm ni en el otro repo: diagnostico.mjs, probar-repetidas.mjs, trabajador-tablero/pruebas/claude-falso.mjs], probar-fallas-repetidas.mjs, repetidas.mjs y …
- Qué se intentó: intento 2 de 2 (antes_de_construir; se vuelve a planear)
- Cómo se resolvió: se cambió la tarjeta de repo (o se vuelve a planear) sin construir ni gastar intento
- Regla: Si el plan nombra archivos de otro repo, se cambia la tarjeta de repo y se vuelve a planear; nunca se construye en el repo equivocado.

Líneas del error:

```
no está en aizencrm: diagnostico.mjs
no está en aizencrm: probar-repetidas.mjs
no está en aizencrm: trabajador-tablero/pruebas/claude-falso.mjs]
no está en aizencrm: probar-fallas-repetidas.mjs
no está en aizencrm: repetidas.mjs
no está en aizencrm: config.mjs
no está en aizencrm: recoger-errores.mjs
```

### 2026-11-27 20:07 · epltht7s Cabecera del chat rediseñada: asesor, franja del agente y seguimiento — parte 1: Maqueta de la cabecera del chat: página nueva con la vista de computador
<!-- incidente:epltht7s:2026-11-27 20:07 -->

- Repo: aizencrm
- Qué falló: el plan nombra archivos que no están en este repo (repo equivocado)
- Causa: El plan nombra archivos que no están en aizencrm ni en el otro repo: lib/prisma, app/actions, src/app/cliente/maquetas
- Qué se intentó: intento 1 de 2 (antes_de_construir; se vuelve a planear)
- Cómo se resolvió: se cambió la tarjeta de repo (o se vuelve a planear) sin construir ni gastar intento
- Regla: Leer el error completo, no solo la primera línea.

Líneas del error:

```
no está en aizencrm: lib/prisma
no está en aizencrm: app/actions
no está en aizencrm: src/app/cliente/maquetas
```

### 2026-11-27 20:09 · epltht7s Cabecera del chat rediseñada: asesor, franja del agente y seguimiento — parte 1: Maqueta de la cabecera del chat: página nueva con la vista de computador
<!-- incidente:epltht7s:2026-11-27 20:09 -->

- Repo: aizencrm
- Qué falló: el plan nombra archivos que no están en este repo (repo equivocado)
- Causa: El plan nombra archivos que no están en aizencrm ni en el otro repo: page.tsx, maqueta-cabecera.tsx, .ts, .tsx, dh15y53c.md
- Qué se intentó: intento 2 de 2 (antes_de_construir; se vuelve a planear)
- Cómo se resolvió: se cambió la tarjeta de repo (o se vuelve a planear) sin construir ni gastar intento
- Regla: Si el plan nombra archivos de otro repo, se cambia la tarjeta de repo y se vuelve a planear; nunca se construye en el repo equivocado.

Líneas del error:

```
no está en aizencrm: page.tsx
no está en aizencrm: maqueta-cabecera.tsx
no está en aizencrm: .ts
no está en aizencrm: .tsx
no está en aizencrm: dh15y53c.md
```

### 2026-11-27 22:07 · y25hjcgg Coordinador: revisar repo y "ya está en main" antes de planear; contestar preguntas de la nube solo — parte 3: Coordinador: si ya está en main, HECHO sin const…
<!-- incidente:y25hjcgg:2026-11-27 22:07 -->

- Repo: aizencrm
- Qué falló: el plan nombra archivos que no están en este repo (repo equivocado)
- Causa: El plan nombra archivos que no están en aizencrm ni en el otro repo: migration.sql, sql-trabajador.ts, diagnostico.mjs, reglas-trabajador.ts, trabajador.ts y 3 más
- Qué se intentó: intento 2 de 2 (antes_de_construir; se vuelve a planear)
- Cómo se resolvió: se cambió la tarjeta de repo (o se vuelve a planear) sin construir ni gastar intento
- Regla: Si el plan nombra archivos de otro repo, se cambia la tarjeta de repo y se vuelve a planear; nunca se construye en el repo equivocado.

Líneas del error:

```
no está en aizencrm: migration.sql
no está en aizencrm: sql-trabajador.ts
no está en aizencrm: diagnostico.mjs
no está en aizencrm: reglas-trabajador.ts
no está en aizencrm: trabajador.ts
no está en aizencrm: route.ts
no está en aizencrm: probar-ya-en-main.mjs
no está en aizencrm: repo-correcto.mjs
```

### 2026-11-27 22:07 · tptv0zn4 Cabecera del chat rediseñada: asesor, franja del agente y seguimiento — parte 2: Maqueta de la cabecera del chat: vista de celular (390 px) y recuadro explicat…
<!-- incidente:tptv0zn4:2026-11-27 22:07 -->

- Repo: aizencrm
- Qué falló: el plan nombra archivos que no están en este repo (repo equivocado)
- Causa: El plan nombra archivos que no están en aizencrm ni en el otro repo: maqueta-cabecera.tsx, src/app/cliente/maquetas/cabecera-del-chat/explicacion.tsx, explicacion.tsx, lib/prisma, app/actions
- Qué se intentó: intento 1 de 2 (antes_de_construir; se vuelve a planear)
- Cómo se resolvió: se cambió la tarjeta de repo (o se vuelve a planear) sin construir ni gastar intento
- Regla: Leer el error completo, no solo la primera línea.

Líneas del error:

```
no está en aizencrm: maqueta-cabecera.tsx
no está en aizencrm: src/app/cliente/maquetas/cabecera-del-chat/explicacion.tsx
no está en aizencrm: explicacion.tsx
no está en aizencrm: lib/prisma
no está en aizencrm: app/actions
```

### 2026-11-27 22:08 · tptv0zn4 Cabecera del chat rediseñada: asesor, franja del agente y seguimiento — parte 2: Maqueta de la cabecera del chat: vista de celular (390 px) y recuadro explicat…
<!-- incidente:tptv0zn4:2026-11-27 22:08 -->

- Repo: aizencrm
- Qué falló: el plan nombra archivos que no están en este repo (repo equivocado)
- Causa: El plan nombra archivos que no están en aizencrm ni en el otro repo: dh15y53c.md, explicacion.tsx, lib/prisma, app/actions, maqueta-cabecera.tsx y 1 más
- Qué se intentó: intento 2 de 2 (antes_de_construir; se vuelve a planear)
- Cómo se resolvió: se cambió la tarjeta de repo (o se vuelve a planear) sin construir ni gastar intento
- Regla: Leer el error completo, no solo la primera línea.

Líneas del error:

```
no está en aizencrm: dh15y53c.md
no está en aizencrm: explicacion.tsx
no está en aizencrm: lib/prisma
no está en aizencrm: app/actions
no está en aizencrm: maqueta-cabecera.tsx
no está en aizencrm: page.tsx
```

### 2026-11-27 23:18 · fectt7vs Coordinador: máximo 2 intentos por tarjeta, parar con explicación de 3 líneas y partir las grandes antes de construir — parte 1: Coordinador: contar los intent…
<!-- incidente:fectt7vs:2026-11-27 23:18 -->

- Repo: aizencrm
- Qué falló: el plan nombra archivos que no están en este repo (repo equivocado)
- Causa: El plan nombra archivos que no están en aizencrm ni en el otro repo: sin-latido.mjs, diagnostico.mjs, bucle.mjs, recoger-errores.mjs, probar-trabajador.mjs y 7 más
- Qué se intentó: intento 1 de 2 (antes_de_construir; se vuelve a planear)
- Cómo se resolvió: se cambió la tarjeta de repo (o se vuelve a planear) sin construir ni gastar intento
- Regla: Si el plan nombra archivos de otro repo, se cambia la tarjeta de repo y se vuelve a planear; nunca se construye en el repo equivocado.

Líneas del error:

```
no está en aizencrm: sin-latido.mjs
no está en aizencrm: diagnostico.mjs
no está en aizencrm: bucle.mjs
no está en aizencrm: recoger-errores.mjs
no está en aizencrm: probar-trabajador.mjs
no está en aizencrm: probar-repetidas.mjs
no está en aizencrm: probar-sin-latido.mjs
no está en aizencrm: probar-medir.mjs
```
