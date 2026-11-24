## Conceptos del negocio
- `origen_web`: chats que llegan del botón de WhatsApp de magilus.com con el texto "vengo de magilus.com". Si es el primer mensaje del contacto (y no está bloqueado), el webhook de Evolution le pone la etiqueta "Web" y guarda en la ficha el origen `web` (`metadata.origen.canal = "web"` y `crmOrigin = "web"`, solo si no tenía origen). No cambia la etapa ni la asesora y no manda mensajes (`src/lib/origen-web.ts`). Solo Evolution: la API oficial y WAHA no lo marcan.

## Advertencias de operación
- `chats_web_linea_admin`: los chats web que entran por la línea Admin ya no se ocultan del CRM (`excludedFromCrm = false`), así que entran al público de campañas y de las automatizaciones que mandan mensajes, como cualquier lead de ventas.
