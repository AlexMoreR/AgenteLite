## Conceptos del negocio
- `origen_web`: chat que llega del botón de WhatsApp de magilus.com con el texto "vengo de magilus.com". En su primer mensaje (por Evolution) se le pone la etiqueta "Web" y se guarda `metadata.origen = { canal: "web" }` y `crmOrigin = "web"` si no tenía origen (`src/lib/origen-web.ts`). No cambia la etapa ni la asesora asignada.

## Advertencias de operación
- `origen_web_linea_admin`: los chats web que entran por la línea Admin ya no se ocultan del CRM (`excludedFromCrm = false`), así que entran al público de las campañas y de las automatizaciones que mandan mensajes.
