# Agentes de área (molde) — hoy, el Agente de Ventas y el Agente de Marketing

Un **agente por área** (en Magilus nadie es "jefe") que mira su número todos los días, decide qué hace falta y reparte el
trabajo a **subagentes**. Corre en **aizen1** con Claude Code y el plan de Claude del dueño (no la API de pago por uso).
El CRM **no piensa**: da los datos (MCP de AizenCRM y de Gestión), manda los WhatsApp internos que el lanzador le pide y
muestra el resumen en **CRM → Agente de Ventas** (`/cliente/crm/agente-de-ventas`).

## Carpetas

```
agentes-de-area/
├─ correr-agente.mjs            el lanzador (lo que ejecuta la tarea de Windows)
├─ instalar-tarea-windows.ps1   copia todo a D:\Proyectos\agentes y registra la tarea (lun-sáb 7:00)
├─ config.example.json          -> config.local.json (clave del MCP, número de Alexander). NO se sube.
├─ pruebas/probar-lanzador.mjs  pruebas con un Claude y un CRM de mentira
├─ marketing/                   Agente de Marketing (6:45): solo LEE Meta Ads
│  ├─ CLAUDE.md                 su instrucción permanente (número: costo por VENTA por campaña)
│  ├─ .mcp.json.example         -> .mcp.json (AizenCRM, Gestión y Meta Ads; las claves solo viven en aizen1)
│  ├─ .claude/settings.json     EL CANDADO: solo herramientas de lectura de Meta; las que escriben, prohibidas
│  └─ subagentes/vigilante-de-pauta, calidad-del-lead (diarios) e ideas-de-anuncio (lunes)
└─ ventas/
   ├─ CLAUDE.md                 la instrucción permanente del Agente de Ventas
   ├─ .mcp.json.example         -> .mcp.json (conexiones a AizenCRM y Gestión; la clave solo vive en aizen1)
   └─ subagentes/
      ├─ cerrador/PROMPT.md             diario
      ├─ cobrador/PROMPT.md             diario
      └─ analista-de-perdidos/PROMPT.md sábados
```

**Agregar un subagente = agregar una carpeta** con su `PROMPT.md` (encabezado `cuando: diario | sabado | lunes,martes…`).
**Copiar el molde a otra área** (Marketing…) = copiar `ventas/` con otro nombre, cambiar su `CLAUDE.md` y sus subagentes, y
darle su clave en el CRM (`AREAS` en `src/features/agentes-de-area/dominio/reglas.ts`).

## Cómo corre cada mañana

1. 7:00: la tarea abre `claude -p` en `ventas/`. El agente calcula los números de ayer (`numeros_de_ventas`), reparte el
   trabajo a los subagentes, junta lo que entregan, guarda el resumen (`guardar_resumen_del_dia`) y escribe `salida/AAAA-MM-DD.json`.
2. 7:30: **el lanzador** (no Claude) entrega por el MCP (`mandar_whatsapp_al_equipo`): UN mensaje a Alexander y UNO a cada asesora.
3. Si aizen1 estaba apagado o se agotó el límite del plan y la corrida termina después de las 7:30, manda enseguida y el mensaje a
   Alexander empieza con **"Salió tarde (aizen1 prendió a las …)"**.
4. Si Claude llega al límite de uso (lo comparte con el trabajador del tablero), el lanzador espera 30 min y reintenta, hasta 10 veces.
5. Todo queda en `D:\Proyectos\agentes\trabajo\logs\ventas-AAAA-MM-DD.log`. El domingo no corre. Dos disparos el mismo día no repiten nada.

## Lo que garantiza el SERVIDOR (no depende del agente)

- Solo se manda a números de la lista del equipo ("Mi empresa → Equipo"), por la línea Admin (la misma de los avisos del
  Supervisor). **Un cliente nunca recibe nada.**
- Con el **interruptor apagado** (así empieza) no sale nada: solo se guarda el resumen, marcado como prueba.
- Un solo mensaje por persona y por día (clave única en la base).
- Cada intento queda anotado: a quién, qué texto y si salió o por qué no.

## Instalar y probar (en aizen1)

1. `copy config.example.json config.local.json` y completar (clave del MCP creada en Mi empresa → Claude; número de Alexander).
2. `copy ventas\.mcp.json.example ventas\.mcp.json` y pegar las claves.
3. `powershell -ExecutionPolicy Bypass -File agentes-de-area\instalar-tarea-windows.ps1`
4. Corrida de prueba con el interruptor **apagado**: `node correr-agente.mjs --area ventas --forzar --forzar-sabado`
   (genera todo, incluido el análisis del sábado; cada mensaje queda como "no se mandó: interruptor apagado").
5. Mostrar el resultado al dueño en la pantalla y por voz (`agente_de_ventas`). El interruptor lo prende solo el dueño.

## Agente de Marketing

- Corre a las 6:45 (lunes a sábado; el lunes agrega *Ideas de anuncio*), antes del de Ventas. Lee Meta Ads (SOLO lectura), el CRM
  (`numeros_de_marketing`) y Gestión; guarda su resumen con `guardar_resumen_del_dia` (`area: "marketing"`): tabla por campaña y anuncio,
  una línea y máximo 1 recomendación (subir, bajar o cambiar un anuncio) con su dato. **Nunca manda WhatsApp.**
- A las 7:30 el lanzador de **Ventas** agrega esa línea al MISMO mensaje de Alexander, solo si el interruptor de marketing está prendido
  (espera hasta 15 min si marketing sigue corriendo; si no corrió: "Marketing: sin resumen hoy"; si salió tarde, lo dice).
- Pantalla: CRM → Agente de Marketing (`/cliente/crm/agente-de-marketing`). Voz: herramienta `agente_de_marketing`.
- El **candado** de Meta es `marketing/.claude/settings.json`; el lanzador se lo pasa a Claude Code (`--allowedTools` / `--disallowedTools`).
  **Antes de la primera corrida**, comprobar en aizen1 los nombres reales de las herramientas del conector de Meta (`/mcp`) y ajustar las
  dos listas si difieren: lo que no esté en la lista de permitidas queda bloqueado, y `probar-solo-lectura-meta.mjs` revisa que ninguna que escriba esté permitida.
- Prueba real con el interruptor apagado: `node correr-agente.mjs --area marketing --forzar --forzar-lunes`; revisar el registro
  (`trabajo\logs\marketing-AAAA-MM-DD.log`) y el historial de actividad de la cuenta en Meta (no debe haber ningún cambio).

Pruebas del repo: `npm run test:agentes-de-area`, `npm run test:agente-de-marketing` y `npm run test:agentes-de-area-migracion`.
