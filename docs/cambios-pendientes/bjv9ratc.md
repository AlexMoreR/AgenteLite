## Qué no existe hoy
- `campana_del_anuncio`: Evolution entrega el id y el título del anuncio, pero no la campaña (ni su nombre ni su id); "nacional" o "Cali" solo se sabe si el título del anuncio lo dice. Alternativa: poner la ciudad en el título o usar un mensaje prellenado distinto por anuncio.

## Advertencias de operación
- `origen_del_cliente`: la ficha del chat muestra "Origen" y `listar_conversaciones` filtra por `origen` (anuncio, marketplace, organico; revisa hasta 500 chats del periodo). Aquí manda primero el anuncio; lo que se manda a Gestión (`armarOrigenDeVenta`) le da prioridad a la línea. Los chats anteriores a la captura salen como "Orgánico / desconocido".
