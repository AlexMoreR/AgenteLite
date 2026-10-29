## Advertencias de operación
- `lectura_de_pausa_del_bot`: si la base no responde al leer si el chat está pausado, el bot (V2, respuestas rápidas y V3) no contesta ese mensaje y deja en el log "[conversation-automation] no se pudo leer la pausa"; tampoco manda el aviso "En un momento una de nuestras asesoras…". Si el aviso sale en masa, la base tiene problemas.
