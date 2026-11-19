## Conceptos del negocio
- `origen_web`: chats que llegan del botón de WhatsApp de magilus.com con el texto "vengo de magilus.com". En el primer mensaje el contacto queda con la etiqueta "Web" y el origen `web` (`metadata.origen.canal` y `crmOrigin`, si no tenía otro origen). No cambia la etapa ni la asesora y no manda nada por WhatsApp (`src/lib/origen-web.ts`).

## Advertencias de operación
- `origen_web_admin_visible`: los chats web que entran por la línea Admin ya no se ocultan del CRM (`excludedFromCrm = false`), así que entran al público de las campañas y de las automatizaciones que mandan mensajes, como cualquier lead de ventas.
