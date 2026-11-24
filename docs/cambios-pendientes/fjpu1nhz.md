## Conceptos del negocio
- `origen_web`: chats que llegan del botón de WhatsApp de magilus.com, con el texto "vengo de magilus.com" en el primer mensaje; quedan con la etiqueta "Web" y el origen `web` (`metadata.origen.canal` y `crmOrigin`), sin cambiar la etapa ni la asesora.

## Advertencias de operación
- `chats_web_linea_admin`: los chats web que entran por la línea Admin ya no se ocultan del CRM; entran al público de campañas y de las automatizaciones que mandan mensajes.
