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

Desde ERROR el dueño toca **Reintentar**. Si el cambio ya se terminó por fuera del trabajador (por ejemplo,
lo subió Claude Code a mano), no se borra la tarjeta: el dueño toca **Marcar hecho a mano** (desde ERROR,
FALLIDO o POR_REVISAR) con una nota de qué se hizo, y queda HECHO sin que el trabajador la toque.

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

**Hoy (23-oct-2026) todo lo hace Claude Code**: Alexander ya no tiene ChatGPT Plus. Codex queda listo para
activarlo con `"construir": "codex"` cuando vuelva a haber cuenta.

Para ahorrar límite, el Coordinador elige el modelo de cada paso con **reglas fijas en código** (`lib/modelos.mjs`;
ninguna IA decide). `modelos` en la config da el nombre de cada uno; se pasa a `claude --model` y los subagentes
toman `CLAUDE_CODE_SUBAGENT_MODEL`:

| Paso | Modelo | Config |
|---|---|---|
| Planear, tarea difícil | Opus | `planear` |
| Planear, tarea sencilla | Sonnet | `planearSencillo` |
| Construir | Sonnet | `construir` |
| Revisar | Sonnet | `revisar` |
| Subagentes | Sonnet | `subagentes` |
| Leer / resumir (hoy: `claude -p /usage`) | Haiku | `leer` |

**Tarea difícil** = basta UNA de estas: es un reintento (`intentos` > 1); trae la marca `#dificil`, `[dificil]` o
`[opus]` en el título o el detalle; toca la base (nombra `prisma/` o migraciones, o dice migración / prisma /
esquema); toca 3 módulos o más (por las rutas que nombra) o los dos repos; el detalle pasa de 1200 caracteres;
o dice arquitectura, refactor, rediseño, reescribir, seguridad, autenticación o concurrencia.

Cada tarjeta muestra qué modelo usó cada paso ("Planeado con Opus · Construido con Sonnet"): el plan lleva la firma
`Plan escrito con: Claude Code (Opus)` y el resultado trae `modelo` (guardado en el JSON `resultado`, sin migración).

Se elige en `config.local.json`:

```json
"motores": { "planear": "claude", "construir": "claude", "revisar": "claude", "respaldoClaude": false, "respaldoCodex": false },
"modelos": { "planear": "opus", "planearSencillo": "sonnet", "construir": "sonnet", "revisar": "sonnet", "subagentes": "sonnet", "leer": "haiku" },
"comandoCodex": ["codex"],
"pausaLimiteCodexMinutos": 30
```

- `respaldoCodex: false` (por defecto): si Claude pasa el umbral, **solo se avisa** y se sigue con Claude; si se
  agota, las tarjetas esperan al reinicio. Con `true`, los pasos de Claude pasan a Codex mientras tanto.

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

- Si la sesión o la semana llegan a `umbralClaude` (80 % por defecto): con `respaldoCodex: true`, **todos los
  pasos van con Codex** hasta que baje (`Claude al 83 % (sesión): planear y revisar pasan a Codex hasta 3:20pm`);
  con `respaldoCodex: false` (hoy) se sigue con Claude y solo se avisa.
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

### Riesgo BAJO / ALTO (desde el 24-oct-2026)

El CRM aprueba solo las tareas sencillas y de riesgo BAJO; lo importante sigue esperando el sí del dueño.
El trabajador aporta tres cosas (las reglas están en `src/features/tableros-inteligentes/services/reglas-riesgo.ts`
y se espejan en `lib/riesgo.mjs`):

- **Al planear**: el plan trae, en sus primeras líneas, `RIESGO: BAJO — <motivo>` o `RIESGO: ALTO — <motivo>`.
  Es BAJO solo si no toca zonas protegidas, la migración no existe o es aditiva, no toca dinero, permisos ni
  mensajes a clientes, y no toca el trabajador ni las reglas de aprobación. Con duda, ALTO. Si la tarjeta
  ya trae `riesgo` y `riesgoMotivo`, el prompt lo menciona. El prompt también pide no escribir DROP, DELETE,
  UPDATE, RENAME ni TRUNCATE en la parte 4 (migración) salvo que de verdad se usen, porque el CRM la revisa
  por palabras.
- **Al construir**: el resultado trae `archivos` (las rutas que de verdad cambió, hasta 300) y
  `migracionDestructiva` (las palabras de SQL destructivo de las migraciones nuevas, `[]` si es aditiva o no
  hay migración). Si hay algo destructivo, `pruebas` lleva una línea `⚠ migración con cambios destructivos: ...`;
  no hace fallar la construcción. El CRM usa ambos para la última revisión de riesgo.

**Ojo**: un trabajador sin actualizar no manda la línea de riesgo ni `archivos`, y el CRM cuenta sus planes como
ALTO (siguen pidiendo la aprobación del dueño). Para que funcione la aprobación automática hay que actualizar el
trabajador del PC **aizen1** (`git pull` y reiniciarlo).

### Reparar solo (desde el 24-oct-2026)

Antes, si algo fallaba, la tarjeta se reintentaba igual o quedaba en ERROR sin decir por qué. Ahora, cuando una
etapa falla, el Coordinador (`lib/bucle.mjs`, `lib/diagnostico.mjs`):

1. **Diagnostica**: guarda el error completo y el log del intento (`<carpetaTrabajo>/intentos/<id>/`), lo clasifica
   en una categoría (`no_compila`, `fallan_pruebas`, `lint`, `choca_con_main`, `migracion`, `limite_claude`,
   `tiempo_agotado`, `sesion_atascada`...) y escribe la causa en UNA línea.
2. **Decide**: *esperar* (límite de uso de Claude, PC lleno, carpeta trabada: no cuenta como intento ni como
   reparación), *reparar* (el siguiente intento recibe la causa y el error exacto y corrige solo eso; hasta 3),
   *partir* (si es muy grande, la divide en 2 a 4 tarjetas que dependen una de otra y se hacen en orden) o
   *escalar* (después de 3 reparaciones queda en ERROR con un resumen de 3 líneas: qué falló, qué se probó y qué
   necesita del dueño).
3. Cada paso queda en la ficha de la tarjeta ("Por qué está en ERROR" e "Intentos").

Lo que se guarda cuando un comando falla (`lib/procesos.mjs`): las líneas que fallaron (`not ok`, `error`,
`FAIL`...) con un poco de contexto, las últimas 60 líneas, y la salida COMPLETA en un archivo
(`intentos/<id>/salida-...log`). El diagnóstico lee todo eso, no solo el final.

**Sesión de construir**: no puede lanzar subagentes ni tareas en segundo plano ni quedarse esperando (`Agent` y
`Task` van en `herramientasProhibidas`); lo hace todo ella, en orden y en primer plano. Al planear sí puede usar
subagentes.

**Sesión atascada** (`lib/atasco.mjs`): cada minuto se mira si la sesión de Claude tocó archivos (`git status`)
o usó el procesador (ella o sus hijos). Si pasan `atasco.minutos` (15) sin ninguna de las dos, se corta con la
causa `sesion_atascada`; el siguiente intento recibe la orden de no esperar nada, y si se vuelve a atascar la
tarea se parte. En `config.local.json`: `"atasco": { "minutos": 15, "revisarCadaSegundos": 60,
"cpuMinimaSegundos": 0.3 }` (`minutos: 0` lo apaga).

**Aviso "carpeta sin confianza" de Claude Code**: no es la falla (los permisos del Coordinador van en los
argumentos con que arranca cada sesión, no en `.claude/settings.json`) y el diagnóstico ignora esa línea. Para
que deje de salir, abrir Claude Code una vez en la carpeta del repo y aceptar "confiar en esta carpeta" (a
mano), y no dejar en `.claude/settings.json` permisos de un solo uso.

**Orden al subir este cambio**: primero sube el CRM (trae la migración `20261024120000_tablero_intentos`) y
después se actualiza el Coordinador en aizen1 (`git pull` y reiniciarlo). Al revés, el Coordinador nuevo
llamaría rutas (`/reparar`, `/partir`, `/arranque`) que el CRM viejo todavía no tiene (el Coordinador lo
nota: si /tomar no trae `topeReparaciones`, se porta como antes).

**Dependencias**: una flecha marcada "esto depende de aquella" (`conectar_tarjetas` con `depende`, o el botón de
la ficha) hace que la tarjeta no se tome hasta que la otra esté HECHO.

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
- `lib/diagnostico.mjs`: clasifica una falla, decide (reparar, partir, esperar, escalar) y escribe el resumen de 3 líneas.
- `lib/atasco.mjs`: detecta una sesión quieta (sin archivos ni procesador por 15 min).
- `lib/git.mjs`, `lib/procesos.mjs`, `lib/zonas.mjs`, `lib/crm.mjs`, `lib/config.mjs`, `lib/registro.mjs`.
- La API del lado del CRM: `src/app/api/trabajador/tablero/*` y `src/features/tableros-inteligentes/services/trabajador.ts`;
  el aviso por WhatsApp, `src/app/api/trabajador/aviso` y `services/aviso-del-trabajador.ts`.
