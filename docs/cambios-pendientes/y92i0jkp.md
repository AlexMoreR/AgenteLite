## Entidades
- `SupervisorAviso`: registro de cada aviso por WhatsApp a una asesora y de cada reasignación automática de chat (tipo AVISO, REASIGNACION, CALIENTE_24H, BOT_PIDIO_ASESORA o SIN_CANDIDATA; asesora, a quién se le pasó, minutos esperando, si el WhatsApp salió o falló). La regla única (chat, tipo, mensaje del cliente que lo provocó) impide avisar dos veces lo mismo.

## Automatizaciones
- `supervisor_avisos_y_reasignacion`: cada minuto, solo en horario laboral (por defecto lunes a sábado de 8:00 a 18:00): a los 5 min sin respuesta de la asesora le manda un WhatsApp (desde la línea Admin, a su número de avisos de Equipo); a los 30 min pasa el chat a otra asesora activa (la de menos chats pendientes) y avisa a la nueva y a la anterior; aviso también si un chat Caliente lleva 24 h sin mensaje suyo o si el bot pidió asesora y nadie contestó en 5 min. Dos interruptores separados (avisos y reasignación), apagados al inicio, y los tiempos se cambian en la tarjeta del Supervisor (`supervisor:reasignacion:<negocio>`). Nunca le escribe al cliente. Con los avisos prendidos, el Supervisor accionable deja de mandar su WhatsApp de "asignado sin respuesta" y "caliente esperando".

## Qué no existe hoy
- `reasignacion_en_api_oficial`: el vigilante de avisos y reasignación solo cubre las líneas con agente V3; los chats de la API oficial de Meta quedan fuera. Un chat se reasigna una sola vez por cada mensaje del cliente.
- `resumen_7_30`: el resumen de las 7:30 no existe dentro del CRM; el conteo de ayer por asesora se lee con la herramienta del MCP `avisos_y_reasignaciones`.

## Advertencias de operación
- `supervisor_avisos_linea_admin`: los avisos salen por la línea configurada (por defecto Admin) y solo si es administrativa; si está desconectada el aviso queda anotado como fallido y la reasignación se hace igual. Una asesora sin número de avisos en Equipo no recibe el WhatsApp (sí el push).
