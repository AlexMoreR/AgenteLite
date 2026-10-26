# Agentes de área (molde) — hoy: Agente de Ventas

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
| `correr-agente.mjs` | El lanzador: abre Claude, espera hasta las 7:30, entrega los mensajes y deja el log. |
| `instalar-tarea-windows.ps1` | Tarea de Windows: lunes a sábado 7:00 a. m., "ejecutar apenas se pueda si se pasó la hora". |
| `config.example.json` | Se copia a `config.local.json` (con la clave del MCP; **nunca se sube**). |
| `pruebas/probar-lanzador.mjs` | Pruebas con un Claude y un CRM de mentira: `npm run test:agentes-de-area-lanzador`. |

Subagentes de Ventas: **cerrador** (diario: 5 clientes más cerca de comprar por asesora, con el mensaje exacto),
**analista de perdidos** (sábado: causas y máximo 3 arreglos; las fallas del bot/sistema no son de la asesora) y
**cobrador** (diario: ventas de Gestión con saldo, por monto y fecha de entrega, con el mensaje de cobro).

## Cómo corre cada mañana

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
# 2. Corrida de prueba (con el interruptor apagado no sale ningún mensaje; --prueba marca el resumen como prueba):
node agentes-de-area\correr-agente.mjs --area ventas --prueba --forzar-sabado --sin-esperar --repetir
# 3. Instalar la tarea programada:
powershell -ExecutionPolicy Bypass -File agentes-de-area\instalar-tarea-windows.ps1
```

Prender el interruptor (pantalla *CRM → Agente de Ventas*) solo con el sí del dueño. El primer día prendido,
comprobar que Alexander recibió **un** mensaje a las 7:30 y cada asesora **uno**.
