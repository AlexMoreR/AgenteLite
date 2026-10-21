# Trabajador del Tablero IA

Es el programa que **ejecuta las tareas aprobadas** del Tablero IA (fase 2). Corre en el PC
**aizen1** (siempre encendido), nunca en el servidor de producción. Cada minuto le pregunta al CRM,
por HTTPS, si hay algo que hacer. No abre puertos ni necesita webhook.

Usa el `claude` que ya está logueado en ese PC (la suscripción de Alexander) y solo trabaja tarjetas
del negocio de su clave.

## Qué hace con una tarjeta

Solo toma tarjetas de un tipo **con aprobación** (como Tarea) que tengan **repo** (`gestion` o
`aizencrm`). Una a la vez.

| La tarjeta está | El trabajador | Queda |
|---|---|---|
| APROBADO | Escribe un **plan** en lenguaje sencillo (`claude -p --permission-mode plan`), sin cambiar nada. | PLAN_LISTO |
| PLAN_APROBADO | En una rama `tablero/<id>-<nombre>` desde `origin/main`: Claude **construye** el plan (puede editar, no puede hacer push). Después el trabajador, él mismo: hace el commit, marca las **zonas protegidas** que toca, corre tsc / build / pruebas, compara el **lint** con el de main (solo cuentan errores nuevos), **ensaya la migración** si hay una nueva (PGlite y producción dentro de `BEGIN … ROLLBACK`) y **sube solo la rama**. | SUBIENDO (sube sola) o POR_REVISAR (espera el sí) |
| SUBIENDO | Rebase de la rama sobre `origin/main`. Si `main` no cambió desde que se construyó, no vuelve a compilar; si cambió, verifica y ensaya otra vez. **Push a main**, espera el CI (`gh run watch`) y comprueba que `/api/version` diga el commit nuevo. | HECHO (con el commit y su link) |

### Sube solo (desde el 21-oct-2026)

El flujo es **Planear → Aprobar plan → Hacer**, y "Hacer" incluye subir a producción. Con
`subirSolo: true` en el repo, cuando todo pasa (compila, pruebas, lint sin errores nuevos, ensayo de la
migración) la tarjeta pasa directo a SUBIENDO y el trabajador la sube **enseguida**, sin esperar el
minuto y antes que cualquier otra tarjeta.

- **Chats, agentes, libro V3 y Meta Ads no suben solos.** Si el cambio toca una ruta de
  `zonasProtegidas` (`CHATS`, `BOT_VENTAS`, `LIBRO_V3`, `META_ADS`), se construye y prueba igual pero
  queda **POR_REVISAR** marcada con la zona, hasta que el dueño dé el "Sí, subir a producción" en la
  pantalla. El plan lo dice desde el principio: "Al terminar: sube solo a producción" o "Al terminar:
  espera tu sí (toca chats / agentes / Meta Ads)".
- **Si algo falla antes de subir**, no sube nada: queda **ERROR** con el motivo en palabras sencillas
  ("No compiló: …", "Fallaron las pruebas…", "El ensayo de la migración falló…") y el detalle técnico debajo.
- **Si el despliegue falla después de subir** (el CI falla, o `/api/version` no muestra el commit nuevo
  o no contesta), el trabajador hace `git revert` de lo que subió y lo empuja a main (sin forzar).
  Queda ERROR: "Se subió, no arrancó y se deshizo; producción vuelve a la versión anterior". Las
  carpetas de migración nuevas se conservan (la migración es aditiva y pudo haber corrido; la base no se
  deshace). Si no logra deshacerlo, el motivo empieza con **"URGENTE: no se pudo deshacer, revisar a mano"**.
- Con `subirSolo` apagado (o sin ponerlo) todo sigue como antes: queda POR_REVISAR y espera el sí final.
- En `aizencrm`, el trabajador **no arranca** con `subirSolo: true` si falta la zona `CHATS`: así un
  descuido en la configuración no puede hacer que un cambio de chats suba solo.
- Un archivo nuevo de chats, agentes o Meta Ads que no calce con ningún glob **subiría solo**: al
  crear carpetas nuevas de esas áreas, agregarlas a `zonasProtegidas`.

Desde ERROR el dueño toca **Reintentar**.

Mientras trabaja manda un **latido** cada minuto. Si el PC se apaga o se cuelga, a los 5 minutos sin
latido la tarjeta pasa a ERROR ("se pasó del tiempo"). Topes por etapa: plan 20 min, construir 90 min,
subir 45 min (el CI de AizenCRM tarda hasta 20 y la versión hasta 8; tiene que alcanzar para deshacer).

Lo que **nunca** hace: push a main de un cambio que no pasó todo, ni de uno que toca una zona
protegida sin el sí final del dueño; push con `--force` a main; `prisma migrate dev` / `db push`; nada
contra la base de producción salvo el ensayo que se deshace (ROLLBACK). Los comandos corren con
`DATABASE_URL` apuntando a nada.

### Actualizar aizen1 al flujo nuevo

1. Traer el código nuevo (`git pull` en la copia del repo de donde corre el trabajador).
2. En `config.local.json`: agregar `"subirSolo": true` en cada repo que deba subir solo, copiar la zona
   `CHATS` y los globs ampliados de `BOT_VENTAS`, `LIBRO_V3` y `META_ADS` desde `config.example.json`, y
   poner `"subirMinutos": 44` en `tiempos` (o quitar la línea).
3. Reiniciar el trabajador (la tarea programada o el `node trabajador-tablero/trabajador.mjs`).

Mientras no se haga, sigue funcionando como antes (todo queda POR_REVISAR).

## Configurar y arrancar (pasos para el dueño)

1. **Crear la clave.** En el CRM, Tablero IA (página de inicio, el listado de tableros) → sección **Trabajador** (solo el dueño o el ADMIN) →
   "Crear clave". Copiarla: se muestra una sola vez.
2. **Configuración.** En `trabajador-tablero/` copiar `config.example.json` a `config.local.json`
   (no se sube a git) y completar:
   - `claveTrabajador`: la clave del paso 1.
   - `carpetaTrabajo`: una carpeta fuera de los repos (ahí van los worktrees temporales y los logs).
   - `repos.*.ruta`: dónde está cada repo en este PC (`D:/Proyectos/AgenteLite`, `D:/Proyectos/Gestion`).
   - `ssh`: para el ensayo de migraciones en producción (`destino` = usuario@servidor con llave ssh sin
     contraseña; `psql` = cómo se llama a psql allá, por ejemplo `docker exec -i <contenedor> psql -U postgres`).
     Si no está y la tarea trae una migración nueva, el trabajador NO la entrega (queda ERROR).
   - `zonasProtegidas`: las rutas (globs) de cada zona (`CHATS`, `BOT_VENTAS`, `LIBRO_V3`, `META_ADS`).
     Las del ejemplo son un punto de partida: revisarlas.
   - `subirSolo`: `true` para que las tarjetas que pasan todo y no tocan una zona suban solas a producción.
   - `subida`: cómo esperar el CI y comprobar la versión de cada repo.
3. **Requisitos del PC.** Node 20+, `git` (con permiso de push a los repos), `gh` logueado (`gh auth status`),
   `claude` logueado, y la llave ssh si se usa el ensayo en producción.
4. **Probar a mano** (una sola vuelta):

   ```
   node trabajador-tablero/trabajador.mjs --una-vez
   ```

   Sin tarjetas aprobadas dice "nada que hacer". Con la clave mal, avisa 401.
5. **Dejarlo andando.** A mano: `node trabajador-tablero/trabajador.mjs` (cada 60 s, Ctrl+C para parar).
   Para que arranque solo al iniciar sesión, correr UNA vez:

   ```
   powershell -ExecutionPolicy Bypass -File trabajador-tablero\instalar-tarea-windows.ps1
   ```

   (Registra la tarea programada "Trabajador Tablero IA". Para quitarla:
   `Unregister-ScheduledTask -TaskName "Trabajador Tablero IA" -Confirm:$false`.)
6. **Ver qué hace:** el log del día en `<carpetaTrabajo>/logs/trabajador-AAAA-MM-DD.log` (se guardan 14
   días), el "último uso" de la clave en el panel Trabajador, y la ficha de cada tarjeta.

Para cortarlo en seco: revocar la clave en el panel Trabajador (deja de entrar al instante).

## Pruebas

```
npm run test:trabajador-tablero
```

Usa un CRM falso (servidor local), un repo git temporal con su "remoto" local y `claude`, `ssh` y `gh`
falsos (`pruebas/*-falso.mjs`). No toca la base ni GitHub. Recorre el flujo completo y los casos de
ERROR (tiempo, tsc, lint nuevo, conflicto, Claude sin cambios, vencimiento por latido), y la zona
protegida (queda POR_REVISAR con la zona marcada).

## Archivos

- `trabajador.mjs`: el bucle.
- `lib/bucle.mjs`: una vuelta (tomar, la etapa con latido, avisar el resultado o el error).
- `lib/etapas.mjs`: planear, construir y subir.
- `lib/ensayo.mjs`: ensayo de migraciones (PGlite y producción en BEGIN…ROLLBACK por ssh).
- `lib/git.mjs`, `lib/procesos.mjs`, `lib/zonas.mjs`, `lib/crm.mjs`, `lib/config.mjs`, `lib/registro.mjs`.
- La API del lado del CRM: `src/app/api/trabajador/tablero/*` y `src/features/tableros-inteligentes/services/trabajador.ts`.
