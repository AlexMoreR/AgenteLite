# Agentes de área (molde) — hoy: Agente de Ventas y Agente de Marketing

Un **agente por área** que mira su número todos los días, decide qué hace falta y reparte el trabajo a
**subagentes**. En Magilus nadie es jefe: se llama "Agente de Ventas". Se empieza solo con Ventas; si sube el
cierre, se copia el molde a Marketing y a las demás áreas (otra carpeta `agentes-de-area/<area>/`).

Corre en **aizen1** con Claude Code usando el **plan de Claude** de Alexander (no la API de pago: el lanzador quita
`ANTHROPIC_API_KEY` del entorno). Comparte el uso del plan con el trabajador del tablero: si se agota el límite,
espera 30 min y reintenta (hasta 6 h), detectándolo igual que el trabajador (`trabajador-tablero/lib/diagnostico.mjs`).
El **CRM no piensa**: da los datos (MCP), guarda el resumen, entrega los WhatsApp internos y los muestra en
`/cliente/crm/agente-de-ventas`. El Supervisor (avisos a 5 min, reasignación a 30) sigue en el CRM.

## Qué hay aquí

| Archivo | Para qué |
|---|---|
| `ventas/CLAUDE.md` | La instrucción permanente del Agente de Ventas: número, metas, límites, paso a paso y formato de mensajes. |
| `ventas/subagentes/<nombre>/PROMPT.md` | Un subagente = una carpeta con su prompt (`Frecuencia: diario` o `sabado`). Agregar un subagente es agregar una carpeta. |
| `ventas/.mcp.json.example` | Conexiones al MCP de AizenCRM y de Gestión. Se copia a `ventas/.mcp.json` (con las claves; **nunca se sube**). |
| `marketing/CLAUDE.md` | La instrucción permanente del Agente de Marketing: su número (costo por **venta**), campañas, cruce, límites y salida. |
| `marketing/subagentes/<nombre>/PROMPT.md` | Vigilante de pauta (diario), calidad del lead (diario) e ideas de anuncio (`Frecuencia: lunes`). |
| `marketing/.claude/settings.json` | **El candado de solo lectura en Meta Ads**: solo permite las herramientas de lectura y prohíbe todas las que escriben. |
| `marketing/.mcp.json.example` | Conexiones al CRM, a Gestión y al conector de Meta Ads (servidor `meta-ads`). Se copia a `marketing/.mcp.json` (**nunca se sube**). |
| `lib/candado-meta.mjs` | Las listas de herramientas de Meta permitidas (lectura) y prohibidas (escritura); el lanzador las pasa a Claude Code. |
| `pruebas/probar-solo-lectura-meta.mjs` | Comprueba el candado: `npm run test:agente-de-marketing-candado`. |
| `correr-agente.mjs` | El lanzador: abre Claude, espera hasta las 7:30, entrega los mensajes y deja el log. |
| `instalar-tarea-windows.ps1` | Tarea de Windows: lunes a sábado 7:00 a. m., "ejecutar apenas se pueda si se pasó la hora". |
| `config.example.json` | Se copia a `config.local.json` (con la clave del MCP; **nunca se sube**). |
| `pruebas/probar-lanzador.mjs` | Pruebas con un Claude y un CRM de mentira: `npm run test:agentes-de-area-lanzador`. |

Subagentes de Ventas: **cerrador** (diario: 5 clientes más cerca de comprar por asesora, con el mensaje exacto),
**analista de perdidos** (sábado: causas y máximo 3 arreglos; las fallas del bot/sistema no son de la asesora) y
**cobrador** (diario: ventas de Gestión con saldo, por monto y fecha de entrega, con el mensaje de cobro).

Subagentes de Marketing: **vigilante de pauta** (diario: gasto, conversaciones, Tibio/Caliente, ventas y costo por
**venta** por campaña y anuncio; marca el que gasta sin calientes, la frecuencia alta y el costo disparado),
**calidad del lead** (diario: clientes reales vs. curiosos y si el problema es el anuncio o la atención) e
**ideas de anuncio** (lunes: máximo 3, solo fotos propias).

## Agente de Marketing: cómo corre

1. **6:45** — `node correr-agente.mjs --area marketing`. Lee Meta Ads (**solo lectura**), el CRM (`numeros_de_marketing`) y
   Gestión; reparte a sus subagentes y guarda su resumen (`guardar_resumen_del_dia` con `area: "marketing"`) con UNA línea
   para Alexander y máximo UNA recomendación (subir, bajar o cambiar un anuncio) con su dato. **No manda WhatsApp.**
2. **7:00** — corre el Agente de Ventas, que lee el resumen de marketing (`agente_de_marketing`).
3. **7:30** — el mensaje a Alexander que arma Ventas lleva la línea de marketing **solo si el interruptor de marketing
   está prendido** (en el mismo mensaje, nunca en otro). Si marketing sigue corriendo, Ventas espera hasta 15 min; si no
   corrió, la línea dice "Marketing: sin resumen hoy"; si salió tarde, lo dice.
4. El candado de Meta: `marketing/.claude/settings.json` y los argumentos que abre el lanzador (`--allowedTools` solo de
   lectura, `--disallowedTools` con todas las que escriben). Hay que comprobar en el primer uso que los nombres de
   `lib/candado-meta.mjs` son los del conector de Meta del dueño (`/mcp` en Claude Code los lista); si no coinciden,
   se ajustan ahí y en `settings.json` (la prueba `test:agente-de-marketing-candado` avisa si quedan distintos).

## Cómo corre cada mañana (Ventas)

1. 7:00 — el lanzador abre Claude en `ventas/`. El agente calcula los números de ayer (`numeros_de_ventas`), mide los
   sugeridos de ayer, reparte a los subagentes, guarda el resumen (`guardar_resumen_del_dia`) y deja
   `salida/<fecha>/mensajes.json`. **El agente no puede mandar WhatsApp.**
2. 7:30 — el lanzador entrega los mensajes con `mandar_whatsapp_al_equipo`: UNO a Alexander y UNO por asesora. Si
   terminó después de las 7:30, manda enseguida; si aizen1 prendió tarde, el de Alexander empieza con
   `Salió tarde (aizen1 prendió a las …)`.
3. El **servidor** decide si sale: solo a números de *Mi empresa → Equipo*, por la línea Admin, con el interruptor
   prendido y una vez por persona y por día. Un cliente nunca recibe nada. Con el interruptor apagado (como
   empieza) solo se genera el resumen y cada mensaje queda como "no se mandó: interruptor apagado".
4. Domingo no corre. Cada día deja `logs/AAAA-MM-DD.log` y `logs/AAAA-MM-DD-claude.txt` (salida completa).

## Instalar en aizen1 (una vez)

```powershell
# 1. Copiar esta carpeta a D:\Proyectos\agentes (o dejarla dentro del repo; carpetaTrabajador apunta al trabajador).
copy agentes-de-area\config.example.json agentes-de-area\config.local.json        # poner urlCrm, claveMcp y carpetaTrabajador
copy agentes-de-area\ventas\.mcp.json.example agentes-de-area\ventas\.mcp.json    # poner las claves del CRM y de Gestión
copy agentes-de-area\marketing\.mcp.json.example agentes-de-area\marketing\.mcp.json  # CRM, Gestión y el conector de Meta Ads
# 2. Corrida de prueba (con el interruptor apagado no sale ningún mensaje; --prueba marca el resumen como prueba):
node agentes-de-area\correr-agente.mjs --area marketing --prueba --forzar-lunes --sin-esperar --repetir
node agentes-de-area\correr-agente.mjs --area ventas --prueba --forzar-sabado --sin-esperar --repetir
# 3. Instalar la tarea programada:
powershell -ExecutionPolicy Bypass -File agentes-de-area\instalar-tarea-windows.ps1
```

Después de la corrida de marketing: revisar el registro (`logs\AAAA-MM-DD-claude.txt`) y que **ninguna** llamada fue a una
herramienta de escritura de Meta, y comprobar en Meta Ads (historial de actividad de la cuenta) que no hubo cambios.
Prender el interruptor de Marketing (pantalla *CRM → Agente de Marketing*) solo con el sí del dueño.

Prender el interruptor (pantalla *CRM → Agente de Ventas*) solo con el sí del dueño. El primer día prendido,
comprobar que Alexander recibió **un** mensaje a las 7:30 y cada asesora **uno**.
