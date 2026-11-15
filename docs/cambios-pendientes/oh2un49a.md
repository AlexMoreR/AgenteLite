## Conceptos del negocio
- `grupo_de_la_bandeja`: cuenta como **interno (Equipo)** un contacto con la etiqueta EQUIPO, un número que recibe los avisos internos (Mi empresa → Equipo, "Necesita atención" / Supervisor) o una de las propias líneas del negocio, con y sin el 57. Es **Proveedor** el de etiqueta PROVEEDOR (o PROVEEDORES) que no es del equipo.

## Advertencias de operación
- `chats_sin_internos`: (15-nov-2026) la bandeja de Chats ya no mezcla los internos con los clientes: sin `grupo` en la dirección muestra solo clientes (`GRUPO_POR_DEFECTO = "clientes"`; Todas trae a los proveedores y Mías no). Las pastillas **Equipo** y **Proveedores**, con su número de `/counts`, muestran esos chats aparte; cada una sale solo si tiene chats o si está puesta, y también la ven las asesoras (solo con lo asignado a ellas). Tocar Todas, Mías o Sin asignar vuelve a los clientes. Todas, Mías y Sin asignar ya no cuentan los internos. Con texto en el buscador, o con una lista que filtra por la etiqueta EQUIPO o PROVEEDOR, sí salen. Un link `/c/<n>` abre el chat aunque sea interno. Reenviar, la campanita y Notificaciones piden `grupo=todos` y siguen viendo todo.

## Qué no existe hoy
- `etiqueta_equipo_automatica`: nadie pone la etiqueta EQUIPO ni PROVEEDOR sola; un contacto interno con otro número y sin etiqueta sale en la vista de clientes. Un chat al que se le pone la etiqueta no sale de la lista que está abierta: la lista de internos se guarda un minuto en memoria y se nota en el siguiente pedido de la lista.
