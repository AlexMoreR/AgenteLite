# Trabajador del Tablero IA

Es el programa que **ejecuta las tareas aprobadas** del Tablero IA (fase 2). Corre en el PC
**aizen1** (siempre encendido), nunca en el servidor de producción. Cada minuto le pregunta al CRM,
por HTTPS, si hay algo que hacer. No abre puertos ni necesita webhook.

Usa el `claude` que ya está logueado en ese PC (la suscripción de Alexander) para planear y revisar, y
`codex` (la sesión de ChatGPT Plus) para construir (ver "Motores"). Solo trabaja tarjetas del negocio de su clave.

## Qué hace con una tarjeta

Solo toma tarjetas de un tipo **con aprobación** (como Tarea) que tengan **repo** (`gestion` o
`aizencrm`). Varias a la vez (ver "En paralelo").

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

### En paralelo (desde el 22-oct-2026)

Trabaja hasta `maxParalelo` tarjetas a la vez (config.local.json; 2 si no se pone, máximo 5), cada una
en **su propia sesión de Claude Code**, su worktree (`carpetaTrabajo/wt/<id>-<etapa>`) y su rama.

- **No junta dos que se pisan.** Dos tarjetas del mismo repo que tocan la misma **zona protegida** o el
  mismo **módulo** (`src/features/<x>`, `src/app/<…>`, `src/lib/<x>`, `prisma`, `package.json`…, según
  la parte "5. Archivos que se tocan" del plan) no se construyen a la vez: la segunda **espera en fila**.
  Si el plan no dice archivos, también espera (no se sabe qué toca). Planear nunca choca (solo lee).
  Repos distintos nunca chocan.
- **Cola de subida.** A main de cada repo se sube de a una: rebase sobre lo último de main y, si main
  cambió, compila, prueba y ensaya otra vez antes del push. Si choca, la tarjeta queda ERROR con el
  motivo y main no cambia.
- **Cuida el PC.** Si la CPU (promedio del último minuto) o la memoria pasan de `limites`
  (`cpuPorciento`, `memoriaPorciento`, 85 % por defecto), no abre otra sesión; las que corren siguen.
- **Límite de uso de Claude.** Si la suscripción llega a su límite, la tarjeta se **suelta sin ERROR**
  (vuelve a APROBADO o PLAN_APROBADO, sin gastar el intento) y no abre sesiones por `pausaLimiteMinutos` (30).
- **Subagentes.** Las instrucciones le piden a Claude usar subagentes para investigar el código,
  escribir las pruebas y revisar el cambio antes de entregarlo.
- **El log** antepone la sesión y la tarjeta a cada línea (`[s2 abcd1234] …`) y cada vez que empieza o
  termina una escribe `corriendo N/M tarjetas al tiempo: s1 "…" (construir, aizencrm); s2 …`.
- Del lado del CRM: `/tomar` recibe `{ maxParalelo, excluir }`, `/candidatas` dice qué tomaría y
  `/:id/soltar` devuelve una tarjeta sin error. Un trabajador viejo (sin cuerpo) sigue de a una.

### Motores (Codex y Claude) (desde el 23-oct-2026)

El trabajador usa dos "motores" de IA que ya están logueados en aizen1:

- **Claude Code** (`claude`, la suscripción de Alexander): **planea** y **revisa**.
- **Codex** (`codex`, la sesión de ChatGPT Plus): **construye**.

Se elige en `config.local.json`:

```json
"motores": { "planear": "claude", "construir": "codex", "revisar": "claude", "respaldoClaude": false },
"comandoCodex": ["codex"],
"pausaLimiteCodexMinutos": 30
```

- **Cómo se llama a Codex.** En el worktree de la tarjeta, sin preguntar nada:
  `codex exec --cd <worktree> --sandbox workspace-write --skip-git-repo-check --color never --output-last-message <archivo> -`
  (el prompt va por la entrada; para planear con Codex, `--sandbox read-only`). Nunca con
  `--dangerously-bypass-approvals-and-sandbox`. Corre con el mismo entorno seguro que Claude (sin base de datos).
- **Codex solo escribe archivos.** El commit, las zonas protegidas, tsc / build / pruebas, el lint, el ensayo
  de la migración y la subida los sigue haciendo el trabajador, igual que antes.
- **La revisión.** Cuando construye Codex, después Claude (el motor de `revisar`) mira el cambio contra el plan
  y arregla lo que encuentre. Si la revisión falla, no se pierde lo construido: siguen las verificaciones. Con
  `"revisar": "ninguno"` no hay revisión aparte. Lo que construye Claude no pasa por otra revisión (Claude ya se
  revisa con un subagente).
- **Si Codex se agota** (el aviso de ChatGPT: "You've hit your usage limit… try again in…", 429, quota), la
  tarjeta se **suelta sin ERROR** (vuelve a PLAN_APROBADO sin gastar el intento) y Codex no se usa por
  `pausaLimiteCodexMinutos`. **No pasa a Claude**, salvo con `"respaldoClaude": true`: entonces Claude construye
  desde cero en la misma rama.
- **Qué motor hizo qué.** El log lo dice (`[s1 abcd1234] construir: motor: codex`), el plan termina con
  "Plan escrito con: Claude Code" (o Codex) y el resultado de la tarjeta trae `motor`
  (`{ plan, construir, revisar }`) y la línea "Motores: plan claude · construir codex · revisar claude".

### Alerta de uso de Claude

Cada 10 minutos (`vigilarUsoMinutos`) el trabajador corre `claude -p /usage` y lee algo así:

```
Current session: 36% used · resets Oct 23, 3:20pm (America/Bogota)
Current week (all models): 6% used · resets Oct 30, 7am (America/Bogota)
```

- Si la sesión o la semana llegan a `umbralClaude` (80 % por defecto), **todos los pasos van con Codex**
  (planear y revisar también) hasta que baje. El log dice, por ejemplo:
  `Claude al 83 % (sesión): planear y revisar pasan a Codex hasta 3:20pm`.
- Manda **un** WhatsApp al dueño por cada cruce (con el porcentaje y la hora de reinicio), desde la línea
  Admin del CRM (`POST /api/trabajador/aviso`). Vuelve a avisar solo si bajó del umbral y volvió a subir, o si
  empezó otro periodo. Lo que ya avisó queda en `<carpetaTrabajo>/estado-uso.json`.
- Si no puede leer el uso, lo anota en el log, sigue como si estuviera bajo el umbral (no inventa números) y
  manda **una** alerta "no pude leer el uso de Claude" por día.
- Si Claude de verdad llega a su límite, la tarjeta se suelta sin error y Claude se pausa
  `pausaLimiteMinutos`; mientras tanto sus pasos van con Codex.
- **Para que llegue el WhatsApp**: guardar el número del dueño (solo dígitos, con indicativo, por ejemplo
  `573001234567`) en la AppSetting `trabajador:aviso-telefono:<workspaceId>` del CRM, y tener una línea de
  WhatsApp llamada "Admin" (o con purpose ADMIN) conectada. Sin número, el CRM contesta 412 y el trabajador
  lo anota en el log.

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
   `claude` logueado, `codex` logueado con ChatGPT (`codex login status`), y la llave ssh si se usa el ensayo
   en producción.
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

Usa un CRM falso (servidor local), un repo git temporal con su "remoto" local y `claude`, `codex`, `ssh` y
`gh` falsos (`pruebas/*-falso.mjs`). No toca la base ni GitHub. Recorre el flujo completo y los casos de
ERROR (tiempo, tsc, lint nuevo, conflicto, Claude sin cambios, vencimiento por latido), la zona
protegida (queda POR_REVISAR con la zona marcada), los motores (Codex construye y Claude revisa, Codex
agotado se suelta sin usar Claude, el respaldo de Claude) y la alerta de uso de Claude.

## Archivos

- `trabajador.mjs`: el bucle.
- `lib/bucle.mjs`: el planificador (varias a la vez) y una vuelta (tomar, la etapa con latido, avisar el resultado o el error).
- `lib/choques.mjs`: qué tarjetas no pueden ir a la vez (zona, módulo, cola de subida).
- `lib/recursos.mjs`: CPU y memoria del PC.
- `lib/etapas.mjs`: planear, construir (con su revisión) y subir; `correrMotor` corre Claude o Codex.
- `lib/motores.mjs`: qué motor hace cada paso, el límite de Codex y la vigilancia del uso de Claude.
- `lib/ensayo.mjs`: ensayo de migraciones (PGlite y producción en BEGIN…ROLLBACK por ssh).
- `lib/git.mjs`, `lib/procesos.mjs`, `lib/zonas.mjs`, `lib/crm.mjs`, `lib/config.mjs`, `lib/registro.mjs`.
- La API del lado del CRM: `src/app/api/trabajador/tablero/*` y `src/features/tableros-inteligentes/services/trabajador.ts`;
  el aviso por WhatsApp, `src/app/api/trabajador/aviso` y `services/aviso-del-trabajador.ts`.
