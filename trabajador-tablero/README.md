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

### El plan pasa solo (regla del dueño, 24-oct-2026)

Aprobada la tarea, el plan pasa solo de PLAN_LISTO a PLAN_APROBADO, con cualquier riesgo y aunque
la tarjeta tenga zona protegida (esa zona sigue pidiendo el sí final al subir). **Única excepción:**
el plan toca dinero de Gestión (abonos, saldos, nómina, comisiones, facturación, pagos) o puede subir
presupuesto, activar campañas o crear gasto en Meta Ads: queda PLAN_LISTO con su motivo. El Coordinador
lo dice con una línea del plan, `APROBAR PLAN: SOLO` o `APROBAR PLAN: ESPERA TU SÍ — motivo`, y el CRM
lo revisa por su cuenta como respaldo (archivos de dinero y palabras de presupuesto/campañas/gasto en Meta;
sin la línea, también las palabras de dinero). El interruptor `tablero:planes-solos:<negocio>` (prendido
sin fila) la apaga por negocio; la vuelta del reloj también pasa las PLAN_LISTO que esperaban.

### Sube solo (desde el 21-oct-2026)

El flujo es **Planear → Aprobar plan → Hacer**, y "Hacer" incluye subir a producción. Con
`subirSolo: true` en el repo, cuando todo pasa (compila, pruebas, lint sin errores nuevos, ensayo de la
migración) la tarjeta pasa directo a SUBIENDO y el trabajador la sube **enseguida**, sin esperar el
minuto y antes que cualquier otra tarjeta.

- **Una zona fuera de `zonasQueSubenSolas`** (por ejemplo `CHATS` si el `config.json` real no la trae): si el
  cambio toca sus rutas, se construye y prueba igual pero queda **POR_REVISAR** marcada con la zona, hasta que
  el dueño dé el "Sí, subir a producción" en la pantalla. Es lo seguro si se olvida agregarla.
- **Zonas que suben solas (24-oct-2026, decisión del dueño): `BOT_VENTAS`, `META_ADS`, `LIBRO_V3` y `CHATS` (26-oct-2026).** La
  lista es `zonasQueSubenSolas` del repo (la misma `ZONAS_QUE_SUBEN_SOLAS` del CRM; una zona nueva se agrega a las dos). Sin la lista en
  `config.json`, todo sigue pidiendo el sí. Una tarjeta de esas zonas sube sola si compila y pasa las pruebas,
  más estas **pruebas extra** (si falta una, queda POR_REVISAR con "espera tu sí (motivo)"):
  - **Libro V3**: el que construye escribe `✔ simulación V3: sin cambios fuera de lo pedido` y
    `versión anterior del libro: <número>` (con ese número se vuelve con `v3_volver_a_version`).
  - **Bot de ventas**: escribe `✔ sin mensajes nuevos a clientes`; además, un envío de mensaje nuevo en el
    cambio (`sendMessage`, `enviarMensaje`...) que el plan no menciona no sube solo.
  - **Chats**: el que construye comprueba que el cambio no manda mensajes nuevos a clientes y recién entonces
    escribe `✔ chats: sin mensajes nuevos a clientes`. Regla más dura que la del bot: cualquier envío nuevo en las
    rutas de chats (`sendMessage`, `enviarMensaje`...) deja la tarjeta esperando el sí, aunque el plan lo mencione.
  - **Meta Ads, la única excepción**: si el plan trae la línea `GASTO EN META ADS: <qué>` o el cambio agrega
    `daily_budget`, `lifetime_budget`, `bid_amount`, pasar algo a `ACTIVE`, activar o crear campañas,
    conjuntos o anuncios, queda esperando el sí (nunca sube presupuesto, prende ni crea gasto solo). Leer,
    reportes, pausar, textos y configuraciones sin gasto suben solos. Las herramientas de Meta Ads que se
    usan desde fuera del repo no las controla esta regla.
- **Vigilancia de 30 minutos** (`repos.*.vigilancia`: `minutos`, `cadaSegundos`, `maxErroresNuevos`, `maxSubidaDeEnvios`, `minEnviosParaComparar`, `graciaServerActionMinutos`: 10 por defecto, los minutos en que `Failed to find Server Action` no cuenta como falla), solo
  para esas zonas: antes de subir se toma una foto de los logs del servidor (`ssh.logs`, y `ssh.estado` para
  saber si el contenedor corre y cuántas veces se reinició); después de subir y de comprobar la versión, se
  vigilan los logs. Si aparecen `maxErroresNuevos` líneas de error que no estaban antes, el contenedor se
  cae o se reinicia, suben los envíos de mensajes fallidos, los envíos por minuto pasan de
  `foto × maxSubidaDeEnvios` (por defecto 1.5, es decir 50 % más) y de `minEnviosParaComparar` (por defecto 5
  por minuto; por debajo no se compara), o no se pueden leer los logs 5 veces seguidas, se hace `git revert` con un commit nuevo
  (sin force-push), la tarjeta queda ERROR con "Revertida: motivo" y se avisa al dueño por WhatsApp (aviso de
  tipo `necesita` con el motivo, el commit deshecho y el de la reversión; si el deshacer falló, empieza con
  "URGENTE"). Los envíos se cuentan por minuto según el `--since` de `ssh.logs` (3 min si no lo trae). Si todo va bien,
  la tarjeta dice "Subió sola (zona X) — vigilancia 30 min OK". **Mientras se vigila, no sube otra
  tarjeta.** Sin `ssh.logs` el trabajador no arranca con `zonasQueSubenSolas` (no hay forma de vigilar).
- **Si algo falla antes de subir**, no sube nada: queda **ERROR** con el motivo en palabras sencillas
  ("No compiló: …", "Fallaron las pruebas…", "El ensayo de la migración falló…") y el detalle técnico debajo.
- **Si el despliegue falla después de subir** (el CI falla, o `/api/version` no muestra el commit nuevo
  o no contesta), el trabajador hace `git revert` de lo que subió y lo empuja a main (sin forzar).
  Queda ERROR: "Se subió, no arrancó y se deshizo; producción vuelve a la versión anterior". Las
  carpetas de migración nuevas se conservan (la migración es aditiva y pudo haber corrido; la base no se
  deshace). Si no logra deshacerlo, el motivo empieza con **"URGENTE: no se pudo deshacer, revisar a mano"**.
  El aviso al dueño por WhatsApp va en 3 líneas y máximo 500 caracteres (el CRM rechaza los más largos); el detalle queda en el tablero.
- **Qué CI cuenta como "el despliegue"**: solo el workflow de `subida.workflowDespliegue` (p. ej. `"docker-image.yml"`, el que
  publica la imagen) más la comprobación de `/api/version`. Se le agrega `--workflow <archivo>` al `gh run list` de `ciBuscar`
  (o se usa `{workflow}` en el comando). Un workflow de revisión (p. ej. «CI tablero») que falle en el mismo commit no deshace
  nada (26-oct-2026: así se deshizo una subida buena). Sin configurarlo queda un aviso en el registro en cada subida.
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
  termina una escribe `corriendo N/M tarjetas al tiempo en aizen1 (y K en la nube): s1 "…" (construir, aizencrm); s2 …`.
- Del lado del CRM: `/tomar` recibe `{ maxParalelo, excluir }`, `/candidatas` dice qué tomaría y
  `/:id/soltar` devuelve una tarjeta sin error. Un trabajador viejo (sin cuerpo) sigue de a una.

### Tareas pequeñas en aizen1, grandes a la nube (desde el 25-oct-2026)

Decisión del dueño: "aprovechar todo". **aizen1 corre como máximo 2 tareas a la vez** (`maxParalelo`, 2) y las
grandes se construyen en la nube de Claude con `claude --cloud`, sin copiar y pegar. La regla es fija, sin IA
(`lib/nube.mjs`, `lib/bucle.mjs`) y se aplica al momento de CONSTRUIR; planear (escribir el plan) y subir
siguen en aizen1.

| Tarea | A dónde va |
|---|---|
| **GRANDE**: el plan nombra más de 8 archivos (parte 5), trae migración, crea un agente nuevo, o ya falló por tamaño o recursos (`tiempo_agotado`, `pc_sobrecargado`, `tarea_muy_grande`) | **siempre a la nube** |
| pequeña, con puesto libre en aizen1 | aizen1 |
| **desborde**: aizen1 ya tiene 2 y hay más aprobadas en fila | la siguiente va a la nube aunque sea pequeña |
| espera su *plan* (APROBADO) | no va a la nube: espera puesto en aizen1 |

- **En la nube no hay tope fijo**, solo uno de seguridad: `nube.maxTareas` (8). Una tarea de la nube **no
  ocupa** un puesto de aizen1 (el CRM da 12 en total). Si Claude dice "límite de uso", la tarjeta se suelta sin
  error y sin gastar el intento, como hoy.
- **Cómo se manda** (`etapas.mjs`, `construirLaParteDeLaNube`): (1) crea la rama `tablero/<id>-<nombre>` desde
  main y la sube a GitHub **sin `--force`** (si ya existe de un intento anterior usa `-nube2`, `-nube3`…);
  (2) desde un worktree de esa rama lanza `claude -p --cloud … --output-format json` con la instrucción por
  stdin: el plan aprobado completo, la orden de leer `CLAUDE.md`, las 4 lecciones (preparar con `npm ci` →
  `npx prisma generate` → build → pruebas; todo en primer plano; dejar todo en la rama; si falla, las últimas 30
  líneas del error), las prohibiciones (nada de bases de datos, claves, `.env` ni `--force`; no tocar el bot, el
  libro V3 ni Meta Ads) y las variables **no secretas** (`nube.entorno`: la misma dirección de base falsa que
  usa aizen1 para compilar). Las claves de producción **nunca** van a la nube.
- **Vigilar sin interrumpir**: cada minuto (`nube.vigilarCadaSegundos`) mira la rama con
  `gh api repos/<dueño>/<repo>/commits?sha=<rama>` buscando el commit vacío
  `resultado: build=OK|FALLO tests=OK|FALLO segundos=N`. **Nunca** `claude --teleport`. Mientras tanto el
  latido de la tarjeta sigue (con `{ lugar: "nube", sesion }`: el CRM guarda el link `claude.ai/code/session_…` y
  da 180 minutos en vez de 90). La sesión deja primero un commit vacío `inicio: <rama>`; si no aparece ningún commit en
  `nube.sinSenalMinutos` (20), o deja `pregunta: <…>`, o no aparece `resultado:` en `nube.esperaMinutos` (120), la
  tarjeta pasa a ERROR con el link, sin reparación automática. Lo que vuelve se verifica en
  aizen1 con su propio reloj (`nube.verificarMinutos`, 45) y, como mucho, 2 a la vez (`maxParalelo`): la
  verificación de la nube hace fila para no pasar de los puestos de aizen1.
- **Al volver con `build=OK tests=OK`** (`nube.confiarEnResultado`, sí por defecto; 26-oct-2026, regla del
  dueño): aizen1 **no compila ni prueba nada** (ni `npm ci`, `prisma generate`, tipos, build, pruebas ni lint).
  Solo comprueba que el código de la rama es el mismo que verificó la nube (commit `resultado:`), lee los
  nombres de archivos (zonas protegidas, `.env`), ensaya la migración en producción dentro de BEGIN…ROLLBACK si
  hay (por ssh) y sube. Al subir, si main cambió (desde la base que verificó la nube) archivos que la tarea
  también cambia (sin contar `.md`), no sube a ciegas: la tarjeta se repara con la estrategia `nube` y se vuelve a
  construir y verificar en la nube. Si main cambió otros archivos, sube sin compilar (el CI de main y la
  reversión automática del despliegue cubren el resto). Con `confiarEnResultado: false` se verifica en aizen1 como antes: instala, `prisma generate`,
  tipos, build, pruebas, lint comparado con main y el ensayo en PGlite. Con `FALLO` la tarjeta va a ERROR con
  las 30 líneas que dejó la sesión en la rama (o a reparar, si el CRM entiende reparaciones).
- **"¿Confías en esta carpeta?"**: en un worktree nuevo la terminal real de `claude --cloud` hace esa pregunta
  (marcada en "No, exit"). El Coordinador la contesta solo (flecha hasta "Yes, I trust this folder" y Enter)
  **solo** si la carpeta está dentro de `carpetaTrabajo`; fuera de ahí falla y lo dice.
- **Cola de pasos pesados sin vencer tarjetas**: si la cola de aizen1 ya tiene trabajo en fila, no se toma una
  tarjeta nueva para construir en aizen1 (espera en la fila del tablero, sin candado). Y si una ya tomada espera
  más de `colaPesada.esperaMaximaMinutos` (20) su `npm ci` o el lint de main antes de empezar, se suelta sin
  ERROR ni intento, antes de que venza el candado de 90 min del CRM.
- **La tarjeta** dice "Construida en: aizen1" o "Construida en: la nube · Ver la sesión", y mientras se
  construye "La está construyendo Claude en la nube… Ver la sesión". El panel "Coordinador en vivo" lo muestra
  con `lugar: "nube"` y `linkSesion`.
- **Terminal real**: `--cloud` exige una terminal real (pty). `nube.terminal` = `"auto"` (por defecto) prueba
  primero `claude -p --cloud` sin terminal y, si no da el link, una terminal real con `node-pty`, que NO viene
  instalada: `npm install node-pty --prefix trabajador-tablero` (solo en esta carpeta, nunca en el CRM). Si ninguna
  de las dos funciona sin que alguien la toque, el trabajo se detiene, lo dice en la tarjeta y propone GitHub
  Actions (tarjeta `cmvmjh9a504dp2mrpg7cazs8u`). `"sin-terminal"` y `"pty"` fuerzan una sola vía.
  **Primer paso en aizen1**: lanzar una tarea de prueba desde la tarea programada y comprobar que se lee el link
  y el resultado sin tocar la sesión; la vía de `node-pty` (escribir la instrucción en la terminal) no se pudo
  probar sin una sesión de verdad.
- **Limitación**: si el Coordinador se reinicia con tareas en la nube, pierde la pista de esas sesiones (la
  tarjeta vuelve a la fila al arrancar); la rama queda en GitHub y la sesión puede seguir sola.
- **Entorno de la nube** (`/web-setup` ya hecho con la cuenta del dueño): `AlexMoreR/AgenteLite`,
  `AlexMoreR/Gestion` y `AlexMoreR/messenger-basic` quedan en `config.example.json` con su nombre en GitHub
  (`github`) y sus pasos de preparación (`instalar`, `verificar`, `pruebas`), que van dentro de la instrucción: no
  hay que tocar los otros repos. `messenger-basic` queda configurado, pero hoy el tablero no le crea tarjetas.
- `--una-vez` y las pruebas de una sola vuelta construyen siempre en aizen1; el reparto lo hace el
  planificador (el bucle normal).
- `config.local.json` de aizen1 (no está en el repo): poner `"maxParalelo": 2` (bajarlo de 3) y copiar el bloque
  `nube` y los `github` de `config.example.json`.

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

**La nube usa la misma regla.** Al lanzar `claude -p --cloud` el Coordinador pasa `--model` con el modelo de construir
(Sonnet) y el prompt lo repite ("MODELO PEDIDO"). Si esa versión de `--cloud` rechaza `--model`, se lanza sin él, el
resumen de la tarjeta dice "La nube no deja elegir modelo; se pidió en el prompt." y no se anota `modelo.construir`.
Un modelo no disponible se trata como límite de uso: la tarjeta se suelta y espera, sin gastar intento, y nunca se
cambia a Opus para construir. Dónde corrió cada tarjeta ya está en `resultado.construidoEn` (`aizen1` o `nube`).

Se elige en `config.local.json`:

```json
"motores": { "planear": "claude", "construir": "claude", "revisar": "claude", "respaldoClaude": false, "respaldoCodex": false },
"modelos": { "planear": "opus", "planearSencillo": "sonnet", "construir": "sonnet", "revisar": "sonnet", "subagentes": "sonnet", "leer": "haiku" },
"comandoCodex": ["codex"],
"pausaLimiteCodexMinutos": 30
```

- `respaldoCodex: false` (por defecto): si Claude pasa el umbral, **solo se anota en el log** y se sigue con Claude; si se
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

Cada 5 minutos (`vigilarUsoMinutos`; cada 2 desde el 70 % o en pausa: `pausaUso.vigilarCercaMinutos`) el trabajador corre `claude -p /usage` y lee algo así:

```
Current session: 36% used · resets Oct 23, 3:20pm (America/Bogota)
Current week (all models): 6% used · resets Oct 30, 7am (America/Bogota)
```

- Si la sesión o la semana llegan a `umbralClaude` (80 % por defecto): con `respaldoCodex: true`, **todos los
  pasos van con Codex** hasta que baje (`Claude al 83 % (sesión): planear y revisar pasan a Codex hasta 3:20pm`);
  con `respaldoCodex: false` (hoy) se sigue con Claude y solo se anota en el log.
- **Sin WhatsApp por cruzar el umbral** (26-oct-2026, decisión del dueño: "solo cuando sea súper importante"): el cruce
  solo queda en el log y en el panel (lo que sí avisa es la pausa por uso, ver abajo). Lo último visto queda en
  `<carpetaTrabajo>/estado-uso.json`.
- Si no puede leer el uso, lo anota en el log y sigue como si estuviera bajo el umbral (no inventa números); a la 3.ª falla seguida avisa UNA vez.
- Si Claude de verdad llega a su límite, la tarjeta se suelta sin error y Claude se pausa
  `pausaLimiteMinutos`; mientras tanto sus pasos van con Codex.
- **El único WhatsApp que manda el Coordinador** es el del límite: si Claude se agota y no queda otro motor para
  planear ni construir (todo en pausa), manda UN aviso por pausa con la hora de vuelta
  (`crm.aviso(texto, "limite")` → `POST /api/trabajador/aviso`). El CRM solo deja pasar los avisos con tipo
  `"limite"` o `"necesita"`; sin tipo los descarta sin error (así el manual de la noche y la autoactualización ya
  no mandan WhatsApp). Los demás avisos al dueño (Coordinador caído, sin trabajo, trabado, necesita al dueño) los
  calcula el CRM solo (`services/avisos-al-dueno.ts`).
- **Para que llegue**: guardar el número personal del dueño en la caja "Avisos de Sistemas por WhatsApp" de
  Mi empresa → Claude (ya no en la AppSetting a mano) y tener la línea Admin conectada. Sin número no sale nada y la
  caja lo dice. Este cambio corre en aizen1: `git pull` y reiniciar la tarea.

### Pausa por uso de Claude (26-oct-2026)

Todo el desarrollo se construye en la nube de Claude: si el plan se agota se cae TODO (desarrollo, voz y chat del dueño).
Por eso, al llegar al **umbral** (80 % por defecto, de 50 a 95) de la sesión **o** de la semana, el Coordinador entra en
**"Pausado por uso de Claude"** (`lib/pausa-uso.mjs`):

- No toma tarjetas nuevas (ni planear, ni construir, ni con Codex), y no corren el trabajo de noche del manual ni el recogedor de errores.
- Detiene con orden lo que corre: planear y construir (en aizen1 y en la nube) se cortan y la tarjeta vuelve a la fila
  **sin ERROR y sin gastar intento** ("Pausado por uso de Claude"). Al construir en aizen1, lo ya escrito queda en
  `<carpetaTrabajo>/intentos/<id>/trabajo.patch` y al retomar se reaplica y el agente recibe "RETOMADA: … ya está aplicado".
  **Subir** no usa Claude: termina (cortarlo a medias es más peligroso).
- UN WhatsApp (tipo `limite`): "⛔ Se paró todo: el uso de Claude llegó al 80 %. Se reanuda el <día y hora de Bogotá>." Se manda una
  vez por pausa y queda guardado en `estado-uso.json` (un reinicio del Coordinador no lo repite); en horas de silencio sale a las 7 a. m.
- Sigue leyendo el uso durante la pausa. Sale cuando una lectura nueva baja del umbral (o el dueño apaga el interruptor) y avisa
  en una línea: "✅ Volvió a trabajar: el uso de Claude se reinició." Las tarjetas detenidas se retoman solas y primero.
  Si pasa la hora de reinicio + 30 min y no se puede leer nada, la pausa se levanta sola.
- Si no se puede leer el porcentaje (3 lecturas malas seguidas) **no se pausa** (no hay número): el panel dice "No pude leer el uso
  de Claude desde las …" y sale UN solo aviso, hasta que haya una lectura buena y vuelva a fallar.
- El **interruptor y el umbral** se cambian en el panel "Coordinador en vivo → Uso de Claude" (solo el dueño; AppSetting
  `tablero:pausa-uso-claude:<negocio>`); el CRM se los devuelve al Coordinador en la respuesta del latido. Si el CRM no responde,
  vale `pausaUso` de `config.local.json` (`activa`, `umbral`, `cercaDesde`, `vigilarCercaMinutos`).
- Los Agentes de Ventas y Marketing de aizen1 **no** son parte del Coordinador y no se pausan con esto. Codex también para.

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

### El latido y el panel "Coordinador en vivo" (desde el 24-oct-2026)

Cada 15 segundos el Coordinador manda un **latido** al CRM (`POST /api/trabajador/latido`, con la misma clave
`aizen_trab_...`; `lib/latido.mjs`) para la pestaña **Coordinador en vivo** de Tablero IA (solo para el dueño y el
ADMIN). Lleva:

- las tareas que tiene en las manos: etapa (planeando, construyendo, **probando**, subiendo), dónde corre
  (aizen1; **GitHub Actions** con el link del workflow mientras espera las pruebas automáticas al subir; la
  nube de Claude queda preparada pero hoy no se usa), el modelo (Opus / Sonnet / Haiku), cuándo empezó y en qué
  intento o reparación va;
- la carga de aizen1: procesador y memoria en %, memoria usada de la total en GB y el disco libre de
  `carpetaTrabajo` (`lib/recursos.mjs`), y si está **esperando a que el PC se desocupe**;
- las tarjetas que dejó esperando en fila por chocar con lo que corre, con el motivo;
- si Claude (o Codex) llegó a su límite de uso y cuándo termina la pausa.

El latido es solo información: si el CRM no contesta (o es uno viejo que no conoce la ruta), el Coordinador sigue
trabajando igual y lo anota una sola vez en el log. El CRM guarda solo el último y, si pasan más de 2 minutos sin
recibirlo, el panel dice **"Coordinador apagado o sin conexión"**. Un Coordinador sin actualizar (sin `lib/latido.mjs`)
hace que el panel diga "apagado": para verlo hay que hacer `git pull` en aizen1 y reiniciarlo.

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

**Sin reintentos ciegos (29-oct-2026, el 62 % del uso semanal se fue en reintentos):**

| Categoría | Qué pasó | Qué hace el Coordinador |
|---|---|---|
| `nube_sin_resultado` | la sesión de la nube no dejó `inicio:` ni ningún commit en `nube.sinSenalMinutos` (20), o no dejó `resultado:` en `nube.esperaMinutos` (120) | ERROR enseguida, con el link de la sesión; **no se repara sola** |
| `nube_pregunta` | la sesión dejó el commit vacío `pregunta: <…>` (no pregunta en el chat) | ERROR enseguida con la pregunta y el link |
| `plan_con_preguntas` | el plan aprobado SOLO trae "PREGUNTAS ABIERTAS:" o frases como "hay que confirmar", "antes de construir hay que", "lo que no revisé" (`lib/preguntas-abiertas.mjs`, espejo en `reglas-riesgo.ts`) | no se construye: ERROR + aviso "necesita"; si el dueño aprobó el plan tal cual, sí se construye |
| cualquier otra | la MISMA categoría ya falló 2 veces en la tarjeta (todos los intentos) | escala (salvo `limite_claude`, `pc_sobrecargado`, `carpeta_trabada`, `coordinador_cortado`, que tienen su tope de esperas) |

Además: un plan con preguntas abiertas no se aprueba solo (queda PLAN_LISTO con el motivo), y una tarea cuyo plan
toca **más de una parte del sistema** (`src/modules/X`, `src/features/X`, `src/app/<área>`, `scripts/X`, otro
repo o un cron en aizen1; `lib`, `prisma`, `app/actions`… no cuentan) se parte antes de construir, en aizen1 y en
la nube (`reparto.mjs: partesDelSistemaDelPlan`). Las partes heredan la aprobación si no traen partes del sistema
que el plan no nombre (por ruta o por tema).

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

**Medir antes de planear, esperar a otra, no chocar y recoger los errores viejos (26-oct-2026)**:

- *Medir el tamaño* (`lib/medir.mjs`, `medirAntesDePlanear` en `lib/bucle.mjs`): antes de abrir la sesión de plan se
  mira la tarjeta (largo del texto, puntos que pide, migración, pantalla o módulo nuevo, agente nuevo). Grande → se
  parte en 2 a 4 hijas pequeñas, en orden y unidas con flechas, que quedan "aprobadas, por planear" (sin plan copiado);
  dudosa → una consulta corta con Haiku; chica → a planear. Una parte, una ya partida o una que viene de una
  reparación no se vuelve a partir. En `config.local.json`: `"medir": { "activo": true, "puntosGrande": 4,
  "puntosDudosa": 2, "consultaHaiku": true }`.
- *Esperando a otra*: si el texto nombra otra tarjeta (su id) como molde o requisito, el Coordinador pone la flecha de
  dependencia (`/depender`) y la tarjeta vuelve a la fila con "Esperando a «X»" (o "…, que está en error"), sin ERROR
  y sin contar intento. No es un estado nuevo: se calcula con las flechas.
- *No chocar* (`lib/candado-de-build.mjs`): un solo build a la vez por carpeta. Si aparece "Unable to acquire lock /
  another instance of next build", espera `candadoDeBuild.esperaSegundos` (60), limpia el candado viejo y reintenta
  (hasta `maximoEsperas`, 10). Esas esperas no cuentan como intento ni se descuentan del reloj de la etapa.
- *Recoger los errores viejos* (`lib/recoger-errores.mjs`): una vez al día, y la primera vez que arranca con este
  cambio, revisa las tarjetas en ERROR (`/errores`), les aplica el diagnóstico y las reintenta, las parte o deja UNA
  línea para el dueño (`/:id/recoger`). Máximo 6 por día y 2 recogidas por tarjeta
  (`"recogerErrores": { "maximoPorDia": 6, "maximoPorTarjeta": 2 }`). La fecha de la última recogida va en
  `<carpetaTrabajo>/recoger-errores.json`; las veces y la línea, en `resultado.recogida` de la tarjeta.
- El panel "Coordinador en vivo" y `ver_coordinador` muestran "En error: N" y "Esperando a otra: N" con la lista.

**Dependencias**: una flecha marcada "esto depende de aquella" (`conectar_tarjetas` con `depende`, o el botón de
la ficha) hace que la tarjeta no se tome hasta que la otra esté HECHO.

### GitHub Actions revisa la rama (`ciDeRama`, desde el 26-oct-2026)

Antes, al terminar de construir, aizen1 compilaba y corría todas las pruebas (lo que más carga el PC). Con
`repos.<x>.ciDeRama.activo: true` el orden es otro (necesita el workflow de GitHub que corre build, tipos, pruebas y
lint en cada rama `tablero/**`):

1. Se **sube primero la rama** `tablero/...` (nunca `main`; mismo `pushDeRama` de siempre).
2. Se espera el resultado de Actions para ese commit (`esperarCiDeRama()`: `gh run list --commit` + `gh run watch --exit-status`;
   solo un número cuenta como corrida). Mientras espera, el panel "Coordinador en vivo" muestra "en GitHub".
3. **Pasa:** aizen1 no compila ni prueba. En "pruebas" queda "✔ verificado en GitHub Actions (corrida N)" y el resultado
   trae `linkWorkflow` (la tarjeta muestra "Ver workflow de GitHub Actions") y `verificadoEn: "github-actions"`.
4. **Falla:** se trae `gh run view <corrida> --log-failed`; el error (`ErrorDeEtapa`) lleva las líneas que fallaron y las
   últimas 30, con la categoría según el paso ("no compila", "fallan pruebas" o "lint"). La autorreparación las recibe tal cual.
5. **No responde en `minutos` (20):** no aparece la corrida, `gh` sin sesión, la corrida se pasa del tiempo o termina sin
   un paso fallido que leer. Se compila y prueba en aizen1 como antes, y queda "⚠ Actions no respondió en 20 min: se compiló en aizen1".
   El lint de main solo se mide en este caso.
6. **El ensayo de migraciones contra producción (BEGIN…ROLLBACK) sigue en aizen1** (las claves no van a GitHub).
7. Lo que vuelve de la nube con `confiarEnResultado` ya no compila en aizen1: no usa Actions. `subir()` (a main) no cambia.

**aizen1 ya no compila:** sube la rama y espera a Actions (workflow `.github/workflows/ci-tablero.yml`, «CI tablero»; corre tipos,
lint, build y todos los `test:*` salvo `test:e2e` con `scripts/correr-pruebas-ci.mjs`). Para Gestion y messenger-basic la plantilla
está en `trabajador-tablero/plantillas/ci-tablero.yml` (se copia tal cual y se quitan los pasos de Prisma o Lint si no existen; su
`ciDeRama` viene en `config.example.json` con `activo: false`). El ensayo de migraciones contra producción (BEGIN…ROLLBACK,
`lib/ensayo.mjs`) sigue en aizen1, porque las claves no van a GitHub. Para prenderlo, copiar el `ciDeRama` al `config.local.json`.

`ciDeRama` = `{ activo, buscar, esperar, log, minutos }` (comandos con `{commit}` y `{run}`; ejemplo en `config.example.json`).
Apagado, todo funciona como antes.

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
   - `zonasQueSubenSolas`: las zonas que suben solas aunque estén en `zonasProtegidas` (`BOT_VENTAS`, `META_ADS`,
     `LIBRO_V3`, `CHATS`), con `vigilancia` y `ssh.logs` / `ssh.estado`. Hay que agregarlas al `config.json` real.
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

## Autoactualización (25-oct-2026)

Cuando se sube código nuevo a main, el Coordinador se pone al día solo (antes seguía con el viejo hasta que alguien lo reiniciara a mano).

1. **Cada 10 minutos** (`autoactualizar: { activo: true, cadaMinutos: 10 }` en `config.local.json`; sin esa clave usa esos valores) hace `git fetch` en SU copia (la carpeta del repo desde donde corre) y mira si `origin/main` trae commits que toquen `trabajador-tablero/`. Si no tocan esa carpeta, solo hace `git pull --ff-only` (copia limpia) y sigue sin reiniciar.
2. **Si hay versión nueva**: deja de tomar tarjetas, espera a que terminen las que corren y lo anota ("versión nueva <hash>: no tomo más tarjetas…"). Desde el 27-oct-2026 la espera NO detiene la vuelta: el rescate, las notas de la bóveda y la marca de vida siguen, y cada 5 min anota "sigo esperando N tarjeta(s)…" (antes un `await` esperaba también a las de la nube, hasta 120 min, y el log quedaba mudo).
3. **Con 0 tarjetas**: guarda `<carpetaTrabajo>/actualizacion.json` (`{ anterior, nueva, cuando, estado: "probando" }`), hace `git pull --ff-only` (con cambios locales, sin fast-forward o en otra rama no actualiza: lo anota, avisa y no insiste con ese hash), prueba el código nuevo con `node trabajador-tablero/trabajador.mjs --probar-arranque` (carga la config e importa todos los módulos; no toma tarjetas ni habla con el CRM) y, si pasa, sale con código 0.
4. **Si no arranca**: `git reset --hard <anterior>` (solo en esa copia), estado `revertida` y aviso en una línea (el CRM lo descarta si no trae tipo "limite" o "necesita": queda en el log).
5. **El lanzador** (`lanzador.mjs`, sin imports del resto: solo `node:*`) es lo que la tarea de Windows corre en vez de `trabajador.mjs`. Al ver la salida 0 de una actualización lo relanza de inmediato (sin esperar los 5 min de la tarea); y si el Coordinador nuevo se cae en los primeros 3 minutos (código que pasó la prueba pero falla al correr), hace él mismo el `reset --hard` a `anterior`, marca `revertida`, avisa con `fetch` directo al CRM y vuelve a correr la versión anterior. Cuando el proceso nuevo completa su primera vuelta bien, el estado pasa a `ok` y el log dice "actualizado a <hash>". Sin el lanzador la actualización y la reversión por `--probar-arranque` funcionan igual, pero un código que pasa la prueba y luego se cae no se deshace solo, y el relanzamiento espera a la tarea (≤5 min). El lanzador mismo no se actualiza hasta el siguiente reinicio de la tarea.

**Cambiar la tarea de Windows para que use el lanzador** (una vez, en aizen1; la tarea sigue con su disparador y `MultipleInstances=IgnoreNew`):

```
$t = Get-ScheduledTask -TaskName 'Trabajador Tablero IA'; $a = $t.Actions[0]; $a.Arguments = $a.Arguments -replace 'trabajador.mjs','lanzador.mjs'; Set-ScheduledTask -TaskName 'Trabajador Tablero IA' -Action $a | Out-Null; (Get-ScheduledTask -TaskName 'Trabajador Tablero IA').Actions | Format-List Execute,Arguments
```

Para volver atrás, la misma línea con `-replace 'lanzador.mjs','trabajador.mjs'`. (Se pega en PowerShell tal cual; conserva el `conhost --headless` y la carpeta de trabajo.) Los cambios surten efecto la próxima vez que la tarea arranque el proceso (al reiniciar el Coordinador una vez).

Pruebas: `pruebas/probar-autoactualizar.mjs` (repos git temporales y un Coordinador falso).

## No colgarse: topes y perro guardián (27-oct-2026)

El 27-oct el Coordinador quedó ~25 min mudo con el proceso vivo (esperaba a las tarjetas de la nube para autoactualizarse). Ahora:

- **Cada trabajo de la vuelta tiene tope** (`lib/vuelta.mjs`): llenar 15 min, manual de la noche y recoger errores 30 min, rescate 10, notas 5, autoactualizar 10. Si se pasa, se anota "lleva más de … sin terminar" y la vuelta sigue; no se vuelve a lanzar hasta que termine (nunca dos `llenar` a la vez). Cada pedido al CRM tiene además un tope duro propio (`crm.mjs`), aunque el fetch no respete la señal.
- **Marca de vida**: `<carpetaTrabajo>/vivo.json` con `pid`, `ultimaVuelta` (la última vuelta completa) y `ocupadoEn`/`ocupadoHasta` (qué hace y hasta cuándo puede tardar sin estar colgado).
- **Perro guardián** (`lanzador.mjs`): cada 30 s lee la marca; si max(`ultimaVuelta`, `ocupadoHasta`) tiene más de `perroGuardianMinutos` (config, 10 por defecto; 0 = apagado), mata el proceso con sus hijos y lo arranca de nuevo, con una línea en `logs/lanzador.log` y en el log del día. Solo vigila un Coordinador que ya escribió su marca (una versión vieja sin marca no se reinicia por eso). El lanzador nuevo empieza a vigilar cuando la tarea de Windows lo arranca otra vez.

Pruebas: `pruebas/probar-no-colgarse.mjs` (CRM falso que no contesta, marca vieja → reinicia).

## El manual de la noche

Las tareas **no editan** `docs/que-es-esta-aplicacion.md` (todas lo tocaban y por eso no corrían juntas): dejan una nota en `docs/cambios-pendientes/<id-corto>.md` (las instrucciones de construir, `promptDeConstruir` y `promptDeNube`, lo piden aunque el plan diga otra cosa). El detector de choques (`lib/choques.mjs`) ignora siempre el manual y esa carpeta.

Una vez al día, pasada la hora de la noche (`manual: { activo, hora, repo }` en `config.local.json`; por defecto `true`, 23 h de Bogotá y el repo `aizencrm`), `lib/manual-nocturno.mjs` —lo llama el bucle principal— hace esto, solo si hoy no se hizo y ninguna tarea está subiendo a main:

1. trae lo último de main y abre una copia aparte;
2. si no hay notas (sin contar el `README.md`), lo marca como hecho hoy y termina;
3. abre una sesión de Claude (Sonnet) que pasa cada nota a su sección del manual;
4. revisa antes de subir: solo cambiaron el manual y las notas, siguen todos los títulos `## ...` y se borraron justo las notas pasadas. Si algo falla, no sube nada;
5. hace el commit "manual: junta N notas de cambios pendientes" y lo sube a main sin forzar;
6. avisa en el panel (`crm.aviso`). Si la subida falla (main cambió), reintenta en una vuelta siguiente, hasta 3 veces por noche. El día hecho queda en `<carpetaTrabajo>/manual-nocturno.json`.

Pruebas: en `pruebas/probar-trabajador.mjs` (con el Claude falso).

## Notas nuevas del cerebro en la bóveda (26-oct-2026)

La cuenta de servicio de Google edita los archivos de la carpeta del cerebro, pero no puede **crear** uno nuevo en un Drive personal (403 `storageQuotaExceeded`). Esa carpeta es la bóveda de aizen1 (`D:/Magilus`, sincronizada con Google Drive para escritorio). Cuando el CRM necesita crear una nota (`cerebro_escribir` modo crear o "Pasar al cerebro" a un documento nuevo) deja un pedido PENDIENTE, y `lib/notas-boveda.mjs` —en el bucle principal, cada `boveda.cadaSegundos` (60)— lo crea:

1. `GET /api/trabajador/cerebro/notas-por-crear` -> las pendientes (las más viejas primero, máx. 20);
2. escribe `<boveda.ruta>/<ruta>` creando las carpetas que falten. **Nunca sobrescribe**: si el archivo ya existe, agrega el contenido al final después de una línea `---`. La ruta no puede salir de la bóveda (sin `..`, sin rutas absolutas ni de unidad, ni por un enlace) y solo `.md`/`.txt`; si no sirve, se marca ERROR con el motivo;
3. `POST` `{ id, estado: "CREADA" }` (o `"ERROR"` con `motivo`). Los ids ya escritos quedan en `<carpetaTrabajo>/notas-boveda.json`: si el aviso falló, la vuelta siguiente solo avisa, no escribe dos veces.

Se prende con `"boveda": { "ruta": "D:/Magilus" }` en `config.local.json` (sin ruta, apagado). Si la carpeta no existe (unidad sin montar) no marca nada y reintenta. Pruebas: `pruebas/probar-notas-boveda.mjs`.

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

- `trabajador.mjs`: el bucle (y `--probar-arranque`).
- `lanzador.mjs`: lo que corre la tarea de Windows: arranca `trabajador.mjs`, lo relanza tras una actualización y lo deshace si el nuevo se cae al arrancar.
- `lib/autoactualizar.mjs`: mirar si main trae código nuevo, esperar las tarjetas, `pull --ff-only`, probar el arranque, revertir y el estado `actualizacion.json`.
- `lib/notas-boveda.mjs`: crea en la bóveda local las notas nuevas del cerebro que pidió el CRM.
- `lib/manual-nocturno.mjs`: el manual de la noche (juntar `docs/cambios-pendientes/` en el manual y subirlo a main una vez al día).
- `lib/bucle.mjs`: el planificador (varias a la vez) y una vuelta (tomar, la etapa con latido, avisar el resultado o el error).
- `lib/choques.mjs`: qué tarjetas no pueden ir a la vez (zona, módulo, cola de subida).
- `lib/recursos.mjs`: CPU y memoria del PC (y memoria en GB y disco libre para el latido).
- `lib/latido.mjs`: el latido de cada 15 s al CRM para el panel "Coordinador en vivo".
- `lib/nube.mjs`: la regla de reparto (grande o chica), el lanzamiento de `claude --cloud` (con o sin terminal real), el link de la sesión y la vigilancia de la rama en GitHub.
- `lib/etapas.mjs`: planear, construir (con su revisión) y subir; `correrMotor` corre Claude o Codex.
- `lib/motores.mjs`: qué motor hace cada paso, el límite de Codex y la vigilancia del uso de Claude.
- `lib/ensayo.mjs`: ensayo de migraciones (PGlite y producción en BEGIN…ROLLBACK por ssh).
- `lib/diagnostico.mjs`: clasifica una falla, decide (reparar, partir, esperar, escalar) y escribe el resumen de 3 líneas.
- `lib/medir.mjs`, `lib/candado-de-build.mjs`, `lib/recoger-errores.mjs`: medir el tamaño y las dependencias antes de planear, que los builds no choquen y recoger los errores viejos (ver arriba).
- `lib/atasco.mjs`: detecta una sesión quieta (sin archivos ni procesador por 15 min).
- `lib/git.mjs`, `lib/procesos.mjs`, `lib/zonas.mjs`, `lib/crm.mjs`, `lib/config.mjs`, `lib/registro.mjs`.
- La API del lado del CRM: `src/app/api/trabajador/tablero/*` y `src/features/tableros-inteligentes/services/trabajador.ts`;
  el aviso por WhatsApp, `src/app/api/trabajador/aviso` y `services/aviso-del-trabajador.ts`.
