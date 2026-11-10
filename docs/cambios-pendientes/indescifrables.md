## Entidades
- `MensajeIndescifrable`: un mensaje que WAHA no pudo descifrar (lo avisa el vigilante que lee su log), único por línea e id crudo. Guarda el LID, cuándo pasó y cuándo revisarlo (a los 2 min), y cómo terminó: LLEGO, PERDIDO (con el chat y el teléfono), SOMBRA, IGNORADO (la propia línea o un contacto bloqueado), DESCARTADO (modo APAGADO) o ERROR (5 intentos fallidos). Sin llaves foráneas.

## Automatizaciones
- `mensajes_indescifrables`: a los 2 minutos de un "Undecryptable message" de WAHA mira si llegó un Message con ese id (o un evento del webhook sin Message: reacción, edición o borrado, mensaje sin texto ni archivo). Si no llegó: deja el chat (lo crea si no existe; si el LID no se traduce a teléfono, con el LID y `whatsappLid: true`) con la nota interna "Mensaje perdido, escríbele", lo sube en la bandeja (lo reabre si estaba resuelto), en línea de ventas lo reparte con la rueda de siempre (o avisa por push a su dueña), deja una alerta ALTA en /cliente/alertas (origen "Mensajes perdidos") y manda a Alexander un WhatsApp agrupado, como mucho uno cada 15 min. La línea ADMIN hace todo menos repartir. Nunca escribe un mensaje del cliente ni le escribe al cliente. Modo en `mensajes-indescifrables:modo:<negocio>`: APAGADO (sin fila), SOMBRA (solo mide), PRUEBA (solo los LID de `mensajes-indescifrables:lids-prueba:<negocio>`) o ACTIVO.

## Qué no existe hoy
- `texto_del_mensaje_perdido`: del mensaje indescifrable no se recupera nada (ni texto ni archivo): solo se sabe que el cliente escribió. La asesora tiene que preguntarle.

## Advertencias de operación
- `vigilante_indescifrables`: el aviso depende de un vigilante en el servidor de WAHA (`docker/vigilante-indescifrables`, systemd) que no se instala solo, y de `INDESCIFRABLES_SECRET` igual en los dos lados (vacío en el CRM = rechaza todo). Si el vigilante se cae, los perdidos vuelven a pasar en silencio: mirar su último latido en `mensajes_indescifrables`. El formato de la línea de GOWS no está documentado: probar con `--desde-archivo --simular` antes de instalarlo.
- `mensajes_indescifrables_whatsapp`: el WhatsApp agrupado sale por la línea interna de los avisos por gravedad; si ese WhatsApp está apagado o no hay número de Alexander, los perdidos quedan solo en la bandeja y en las alertas.
