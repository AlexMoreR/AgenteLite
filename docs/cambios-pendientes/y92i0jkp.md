## Entidades
- `SupervisorAviso`: registro de cada aviso por WhatsApp y cada reasignación del Supervisor de reasignación (qué chat, a qué asesora, a cuál se le pasó, minutos esperando, si el WhatsApp salió o falló). Único por chat + tipo + episodio: así el mismo aviso no se repite.

## Automatizaciones
- `supervisor_avisos_y_reasignacion`: cada minuto, en horario laboral (lunes a sábado 8-18 por defecto, configurable), avisa por WhatsApp (línea Admin, número de avisos de Equipo) a la asesora cuyo chat lleva 5 min sin respuesta, y a los 30 pasa el chat a la asesora activa con menos chats esperando (avisa a la nueva y a la anterior). También avisa del Caliente con 24 h sin mensaje de su asesora y del chat donde el bot pidió asesora. Dos interruptores separados y tiempos editables en la pantalla del Supervisor (`supervisor:reasignacion:<negocio>`); nacen apagados. Con los avisos prendidos, el Supervisor accionable deja de mandar su WhatsApp por "asignado sin respuesta" y "caliente esperando".

## Qué no existe hoy
- `supervisor_reasignacion_api_oficial`: el Supervisor de reasignación solo vigila las líneas con agente V3 (Evolution); los chats de la API oficial de Meta no los avisa ni los reasigna.
- `resumen_de_las_7_30`: dentro del CRM no existe el resumen de las 7:30; el conteo de ayer por asesora queda listo en la herramienta del MCP `avisos_y_reasignaciones`.

## Advertencias de operación
- `supervisor_reasignacion_linea_admin`: si la línea Admin está desconectada el aviso no sale (queda anotado como "falló" y la asesora recibe la notificación al teléfono), pero la reasignación se hace igual. Una asesora sin número de avisos en Equipo no recibe el WhatsApp.
