## Módulos
- `embudo-por-paso`: `/cliente/direccion/embudo-por-paso` (solo quien supervisa): barras por producto y fechas de cuántos chats llegaron a cada paso del bot (Presentación, Producto, Objeciones, Cierre), cuántos se quedaron (más de 24 h sin escribir) y la tasa de paso a paso; los chats que tomó una asesora salen aparte.

## Qué no existe hoy
- `embudo_por_paso_historial`: el historial de pasos guarda solo los últimos 10 cambios por chat, así que el tiempo en cada paso es aproximado en chats con muchas vueltas; los chats de antes del 27-oct-2026 solo tienen paso anterior y fecha de entrada si el relleno histórico los reconstruyó.

## Advertencias de operación
- `embudo_por_paso_se_quedo`: «se quedó aquí» no se guarda, se calcula al mirar (paso actual + más de 24 h sin que el cliente escriba); por eso nunca queda desactualizado y no hay reloj.
