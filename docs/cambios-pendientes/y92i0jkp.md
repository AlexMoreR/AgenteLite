## Entidades
- `SupervisorAviso`: registro de cada aviso por WhatsApp a una asesora y de cada reasignación de chat que hace el vigilante del Supervisor (tipo AVISO, REASIGNACION, CALIENTE_24H, BOT_PIDIO_ASESORA, SIN_CANDIDATA o ESCALADA_DUENO; asesora, asesora nueva, minutos esperando, si el WhatsApp salió o falló). Sin llaves foráneas. Una regla única por chat + tipo + hora del mensaje del cliente evita avisar dos veces lo mismo; de ahí sale el conteo diario por asesora.

## Automatizaciones
- `supervisor_avisos_y_reasignacion`: cada minuto, solo en horario laboral (por defecto lunes a sábado, 8:00 a 18:00, configurable), avisa por WhatsApp a la asesora cuando el cliente escribió último y ella lleva 5 minutos sin responder (o el bot pidió asesora), cuando un chat Caliente lleva 24 h sin mensaje suyo, y a los 30 minutos pasa el chat a la asesora activa con menos chats esperando y avisa a la nueva y a la anterior. Los avisos salen de la línea Admin a los números de Mi empresa → Equipo; nunca al cliente. Dos interruptores separados (avisos y reasignación, apagados por defecto) y los tiempos se editan en la tarjeta "Avisos y reasignación de chats" de la pantalla del Supervisor (AppSetting `supervisor:reasignacion:<negocio>`). Con los avisos prendidos, el Supervisor accionable ya no manda su WhatsApp por "asignado sin respuesta" ni "caliente esperando".

## Qué no existe hoy
- `reasignacion_api_oficial`: el vigilante solo mira los chats de las líneas con agente V3 (los mismos que ve el Supervisor, con movimiento en las últimas 72 h); los chats de la API oficial de Meta no se avisan ni se reasignan.
- `resumen_de_las_730`: el resumen de las 7:30 no existe dentro del CRM; el conteo de ayer por asesora se lee con la herramienta del MCP `avisos_y_reasignaciones`.

## Advertencias de operación
- `supervisor_avisos_y_reasignacion`: si la línea Admin está desconectada el aviso no sale (queda "falló" en el registro y la asesora recibe solo la notificación al teléfono), pero la reasignación se hace igual. Cada chat se reasigna una sola vez por cada mensaje del cliente: si la nueva asesora tampoco contesta, el dueño recibe el aviso y el chat no se vuelve a mover. La asesora sin número de avisos en Equipo no recibe el WhatsApp.
