## Conceptos del negocio
- `origen_web`: chats que llegan del botón de WhatsApp de magilus.com, cuyo primer mensaje dice "vengo de magilus.com". Llevan la etiqueta "Web" y quedan con origen `web` (`Contact.metadata.origen.canal = "web"` y `crmOrigin = "web"`, solo si no tenían otro origen). No cambian la etapa ni la asesora asignada.

## Advertencias de operación
- `origen_web_admin`: los chats web que entran por la línea Admin ya no se ocultan del CRM (`excludedFromCrm = false`), así que entran al público de campañas y de las automatizaciones que mandan mensajes.
