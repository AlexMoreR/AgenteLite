## Qué no existe hoy
- `mapa_colombia_ventas_sin_departamento`: Gestión todavía no tiene la lista de ventas pagadas con ciudad y departamento del envío (`GET /api/ventas/pagadas`); hasta que exista, el mapa ubica las ventas solo por la ciudad del chat o el teléfono fijo y muchas salen en "Sin ubicar".

## Advertencias de operación
- `mapa_colombia_llave_meta`: el mapa de Colombia sale gris si el servidor no tiene `META_ADS_ACCESS_TOKEN` (permiso `ads_read`) y `META_ADS_ACCOUNT_ID` (cuenta 392437484223294); abajo dice "Falta la llave de Meta Ads". Si Meta contesta con error dice "Meta Ads no contestó" y el mensaje de Meta queda en el log como "[pauta] no se pudo leer el gasto por región en Meta". Meta llama a Bogotá "Distrito Especial".
