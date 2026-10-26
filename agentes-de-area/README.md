# Agentes de área (molde) — hoy, el Agente de Ventas

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

Pruebas del repo: `npm run test:agentes-de-area` y `npm run test:agentes-de-area-migracion`.
