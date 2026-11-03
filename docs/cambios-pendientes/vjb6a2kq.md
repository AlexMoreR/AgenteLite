## Advertencias de operación
- `panel_meta_del_mes`: el panel "Meta del mes" de Mi día y Mi tablero lee las ventas pagadas del mes de Gestión (`GET /api/ventas/pagadas`, solo leer, 10 s de espera) y las guarda 5 minutos en memoria por negocio y mes (1 minuto si Gestión falló): una venta recién pagada puede tardar hasta 5 minutos en verse, y cada réplica del contenedor tiene su propia copia. Sin metas cargadas en /cliente/metas el panel dice "Todavía no hay metas cargadas". La asesora ve solo su fila y la del equipo; el dueño y los administradores ven todas, las ventas sin asignar y "Editar metas".

## Qué no existe hoy
- `vendedora_y_ganancia_en_gestion`: si Gestión todavía no manda `vendedora`, `ganancia` o `ganancia_confiable` en `/api/ventas/pagadas`, el panel "Meta del mes" no puede calcular comisiones (salen "Sin calcular") ni repartir las ventas por asesora (quedan "sin asignar" y solo cuentan para el equipo).
