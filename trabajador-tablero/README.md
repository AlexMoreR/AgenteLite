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
| PLAN_APROBADO | En una rama `tablero/<id>-<nombre>` desde `origin/main`: Claude **construye** el plan (puede editar, no puede hacer push). Después el trabajador, él mismo: hace el commit, revisa que no toque una **zona protegida**, corre tsc / build / pruebas, compara el **lint** con el de main (solo cuentan errores nuevos), **ensaya la migración** si hay una nueva (PGlite y producción dentro de `BEGIN … ROLLBACK`) y **sube solo la rama**. | POR_REVISAR |
| SUBIENDO (el dueño dio el **sí final**) | Rebase de la rama sobre `origin/main`, verifica y ensaya otra vez, **push a main**, espera el CI (`gh run watch`) y comprueba que `/api/version` diga el commit nuevo. | HECHO |

Si algo falla queda **ERROR** con el motivo (se ve en la ficha). Desde ahí el dueño toca
**Reintentar**. Si el cambio toca una zona protegida (Meta Ads, bot de ventas, libro V3), queda ERROR
"toca zona protegida, aprobar en pantalla" y la tarjeta se marca con esa zona: solo el dueño la
aprueba, en la pantalla.

Mientras trabaja manda un **latido** cada minuto. Si el PC se apaga o se cuelga, a los 5 minutos sin
latido la tarjeta pasa a ERROR ("se pasó del tiempo"). Topes por etapa: plan 20 min, construir 90 min,
subir 30 min.

Lo que **nunca** hace: push a main sin el sí final del dueño, `prisma migrate dev` / `db push`, nada
contra la base de producción salvo el ensayo que se deshace (ROLLBACK). Los comandos corren con
`DATABASE_URL` apuntando a nada.

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
   - `zonasProtegidas`: las rutas (globs) de cada zona. Las del ejemplo son un punto de partida: revisarlas.
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
ERROR (tiempo, zona protegida, tsc, lint nuevo, conflicto, Claude sin cambios, vencimiento por latido).

## Archivos

- `trabajador.mjs`: el bucle.
- `lib/bucle.mjs`: una vuelta (tomar, la etapa con latido, avisar el resultado o el error).
- `lib/etapas.mjs`: planear, construir y subir.
- `lib/ensayo.mjs`: ensayo de migraciones (PGlite y producción en BEGIN…ROLLBACK por ssh).
- `lib/git.mjs`, `lib/procesos.mjs`, `lib/zonas.mjs`, `lib/crm.mjs`, `lib/config.mjs`, `lib/registro.mjs`.
- La API del lado del CRM: `src/app/api/trabajador/tablero/*` y `src/features/tableros-inteligentes/services/trabajador.ts`.
