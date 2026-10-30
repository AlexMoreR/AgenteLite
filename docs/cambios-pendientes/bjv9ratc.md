## Qué no existe hoy
- `origen_campana`: Evolution entrega el id y el título del anuncio, pero no la campaña (ni su nombre ni su id). "Nacional" o "Cali" solo se sabe por el título del anuncio o por un mensaje prellenado distinto por anuncio.
- `origen_chats_antiguos`: los chats anteriores a la captura del anuncio no tienen dato guardado y salen como "Orgánico / desconocido".

## Advertencias de operación
- `origen_del_cliente`: la ficha del chat y `listar_conversaciones` (filtro `origen`: anuncio, marketplace, organico; campo `origen` en cada chat) dan prioridad al anuncio. Gestión (`armarOrigenDeVenta`) da prioridad a la línea: un cliente de anuncio que escribe a "Ventas 2" sale "anuncio" en el CRM y MARKETPLACE en Gestión. Con el filtro se revisan hasta 500 chats del periodo.
