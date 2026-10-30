## Qué no existe hoy
- `campana_del_anuncio`: Evolution entrega el id y el título del anuncio, pero NO la campaña (ni su nombre ni su id); "nacional" o "Cali" solo se sabe por el título del anuncio.

## Advertencias de operación
- `origen_del_cliente`: `listar_conversaciones` filtra por `origen` (anuncio, marketplace, organico); con el filtro revisa hasta 500 chats del periodo. Aquí manda primero el anuncio; lo que se manda a Gestión (`armarOrigenDeVenta`) sigue dando prioridad a la línea.
