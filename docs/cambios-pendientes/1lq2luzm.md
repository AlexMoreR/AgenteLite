## Módulos
- `embudo-por-paso`: `/cliente/crm/embudo-por-paso` (solo quien supervisa) muestra, por producto y fechas, en qué paso del bot se cae la gente: barras de cuántos chats llegaron a Presentación, Producto, Objeciones y Cierre, cuántos se quedaron en cada uno (su paso actual y más de 24 h sin escribir), la tasa de paso a paso (ej. 60 % de Presentación pasa a Producto), el tiempo promedio en cada paso y el paso de mayor caída. Separa los chats que tomó una asesora (IA en pausa o chat asignado) de los del bot. Solo lee `EmbudoLead`; no cambia el bot ni manda mensajes. Desde el MCP, `embudo_por_paso` (producto, desde, hasta; dueño, administradores y supervisora) devuelve lo mismo con un `resumen_para_decir`. Código en `src/features/embudo/dominio/por-paso.ts`; pruebas `npm run test:embudo-por-paso` y `npm run test:mcp-embudo-por-paso`.

## Entidades
- `EmbudoLead`: además guarda el paso anterior (`pasoAnterior`), desde cuándo está en el paso actual (`pasoDesde`) y los últimos 10 cambios de paso (`pasoHistorial`: paso, producto, fecha y si lo hizo el V3 o el V2).

## Qué no existe hoy
- `embudo_por_paso_historia`: el historial de pasos solo guarda los últimos 10 cambios, así que el tiempo promedio por paso es aproximado en chats con muchas vueltas. Los chats anteriores a esta medición solo traen pasos si se corre el relleno histórico del embudo (sección "Historia" de `/cliente/crm/embudo`), que primero simula.

## Advertencias de operación
- `embudo_por_paso`: con el interruptor `embudo:activo:<negocio>` = `false` no se registra ningún paso (ni del V3 ni del V2) y la pantalla y la herramienta avisan que está apagado. "Se quedó aquí" se calcula al mirar (más de 24 h sin escribir), no hay reloj.
