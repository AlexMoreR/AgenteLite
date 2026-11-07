## Advertencias de operación
- `lista_esperando`: `GET /api/cliente/chats/list?espera=1` devuelve los chats que esperan respuesta de una persona, del que más lleva al que menos, con la misma memoria de 60 s y el mismo recorte por persona que el número `espera` de /counts (Todas, Mías, Sin asignar y la línea elegida; ignora condiciones y estado). Pagina con `offset` sobre esa lista (`nextCursor` siempre null) y trae la línea oficial en cualquier página. Con texto en el buscador la búsqueda manda y `espera` no se aplica. Si la espera no se puede leer responde ok con la lista vacía y `esperaNoDisponible: true`. Todavía no hay botón en la pantalla.

## Qué no existe hoy
- `lista_esperando_al_minuto`: la lista "Esperando" puede ir hasta un minuto atrasada: un chat que se contestó o se resolvió en ese minuto no trae fila (no se repite ni se salta ninguno al bajar), y uno que empezó a esperar recién aparece al minuto siguiente.
