## Módulos
- `crm/embudo-por-paso`: reporte del bot por producto y fechas: barras de cuántos clientes llegaron a cada paso (Presentación, Producto, Objeciones, Cierre) y cuántos se quedaron, % de paso a paso y el paso donde más se cae; separa "solo el bot" de "lo tomó una asesora". Enlazado desde el Embudo.

## Qué no existe hoy
- `historial_de_pasos_completo`: EmbudoLead guarda solo los últimos 10 cambios de paso, y un cliente que vuelve a un paso donde ya estuvo no genera otro aviso "entró al paso" (la clave única lo frena), así que esa vuelta no queda en el historial.
- `se_quedo_aqui_guardado`: "se quedó aquí" no es una columna: se calcula al leer (paso actual y más de 24 horas sin que el cliente escriba).

## Advertencias de operación
- `embudo_por_paso_relleno`: pasoAnterior, pasoDesde y pasoHistorial se llenan solos desde que se aplicó la migración 20261029120000_embudo_paso_detalle; para octubre hay que correr el relleno histórico del embudo (primero en simulación, revisar 10 chats a mano) y solo entonces escribir.
- `embudo_por_paso_v2`: el Agente V2 anota "entró al paso X" (datos.agente = V2) desde funnel-stage-sync, en segundo plano; si falla solo queda en el log.
