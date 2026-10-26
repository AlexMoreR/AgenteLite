## Entidades
- `AgenteDeAreaDia`: un resumen por negocio, área y día (sin repetidos): números de ayer, meta, lo que entregó cada subagente, los clientes sugeridos a cada asesora (para medirlos al día siguiente), si fue prueba y si salió tarde.
- `AgenteDeAreaEnvio`: un registro por cada WhatsApp interno que pide un agente de área (a quién, tipo Alexander o asesora, texto, si salió, se bloqueó o falló, y el motivo). Una clave única por número y día garantiza un solo mensaje por persona y por día.

## Automatizaciones
- `agente_de_ventas`: el Agente de Ventas corre en aizen1 (Claude Code, tarea de Windows a las 7:00 a. m., lunes a sábado) y el CRM solo guarda y entrega. Su pantalla es `/cliente/crm/agente-de-ventas` (resumen, un bloque por subagente, mensajes con su motivo, historial e interruptor; la ven dueño, administradores y supervisora, y solo dueño y administradores cambian el interruptor). A las 7:30 manda UN WhatsApp a Alexander y UNO a cada asesora por la línea Admin, solo a números de la lista del equipo. Con el interruptor apagado no sale nada.

## Qué no existe hoy
- `agente_de_ventas_a_clientes`: el Agente de Ventas nunca le escribe a un cliente; el servidor rechaza cualquier número que no sea de la lista del equipo.
- `agente_de_ventas_otras_areas`: solo existe el agente de Ventas; el molde (`agentes-de-area/`) se copia a Marketing y demás áreas cuando se decida.

## Advertencias de operación
- `agente_de_ventas_aizen1`: el Agente de Ventas corre en aizen1; si aizen1 está apagado no hay resumen (al prender corre solo y avisa que salió tarde). Comparte el límite del plan de Claude con el trabajador del tablero.
- `agente_de_ventas_sin_numero`: una asesora sin número en "Mi empresa → Equipo" no recibe su mensaje; la pantalla avisa "sin número de avisos".
