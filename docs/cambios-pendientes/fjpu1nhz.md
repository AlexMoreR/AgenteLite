## Conceptos del negocio
- `origen_web`: chats que llegan del botón de WhatsApp de magilus.com, con el texto "vengo de magilus.com" en el primer mensaje. El webhook de Evolution les pone la etiqueta "Web" y guarda el origen `web` (`Contact.metadata.origen.canal = "web"` y `crmOrigin = "web"`, solo si no había otro origen). No cambia la etapa ni la asesora.

## Advertencias de operación
- `origen_web_linea_admin`: los chats web que entran por la línea Admin ya no se ocultan del CRM (`excludedFromCrm = false`), así que entran al público de las campañas y de las automatizaciones que mandan mensajes.
