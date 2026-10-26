## Entidades
- `AgenteDeAreaDia`: resumen del día de un agente de área (hoy solo `ventas`): números de ayer, meta, lo que entregó cada subagente, clientes sugeridos (para medirlos al día siguiente), mensajes listos y si la corrida fue de prueba o salió tarde. Uno por negocio, área y día; si se guarda dos veces se reemplaza.
- `AgenteDeAreaEnvio`: un registro por cada WhatsApp interno que pidió un agente de área (a quién, texto, ENVIADO / BLOQUEADO / FALLIDO y el motivo). Un índice único parcial deja un solo envío vivo por número, área y día.

## Automatizaciones
- `agente_de_ventas`: el Agente de Ventas corre en aizen1 (tarea de Windows a las 7:00 a. m., lunes a sábado) con Claude Code; reparte el trabajo a tres subagentes y el CRM solo da datos (MCP `numeros_de_ventas`), guarda el resumen (`guardar_resumen_del_dia`), entrega los WhatsApp internos (`mandar_whatsapp_al_equipo`) y se lee con `agente_de_ventas`. Pantalla `/cliente/crm/agente-de-ventas` (CRM → Agente de Ventas; dueño, administradores y supervisora): interruptor, resumen del día, un bloque por subagente, mensajes con su motivo e historial. Interruptor en AppSetting `agente-area:ventas:<negocio>`, apagado por defecto: apagado no sale ningún mensaje. Nunca le escribe a un cliente: el servidor solo deja mandar a números de Mi empresa → Equipo, por la línea Admin, una vez por persona y por día.

## Qué no existe hoy
- `agente_de_ventas_sin_marketing`: el molde de agentes de área existe, pero solo hay Agente de Ventas; Marketing y las demás áreas no tienen agente.
- `agente_de_ventas_sin_dinero`: los números que da el CRM al agente (`numeros_de_ventas`) no incluyen dinero; las ventas, abonos y saldos los lee el agente directo del MCP de Gestión, que es de solo lectura.

## Advertencias de operación
- `agente_de_ventas_aizen1`: el Agente de Ventas corre en aizen1; si aizen1 está apagado, no hay resumen (al prender corre solo y avisa "Salió tarde"). Comparte el límite del plan de Claude con el trabajador del tablero.
- `agente_de_ventas_sin_numero`: una asesora sin número de avisos en Mi empresa → Equipo no recibe su mensaje; la pantalla lo marca como "sin número de avisos".
