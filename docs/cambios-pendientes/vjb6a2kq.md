## Qué no existe hoy
- `metas_vendedora_ganancia`: el panel "Meta del mes" (Mi día y Mi tablero) necesita que Gestión mande `vendedora`, `ganancia` y `ganancia_confiable` en `/api/ventas/pagadas`; mientras no los mande, las ventas quedan "sin asignar", la comisión sale "por confirmar" y el panel lo avisa.

## Advertencias de operación
- `metas_ventas_en_memoria`: el panel "Meta del mes" guarda 5 minutos en memoria (por negocio y mes) las ventas que lee de Gestión; una venta recién pagada puede tardar hasta 5 minutos en verse, y al reiniciar el contenedor se vuelve a pedir.
