## Conceptos del negocio
- `origen_web`: un chat que llega del botón de WhatsApp de magilus.com trae el texto "vengo de magilus.com". Si es el primer mensaje del contacto (y no está bloqueado), la ficha queda con la etiqueta **Web** y el origen `web` (`metadata.origen = { canal: "web" }` y `crmOrigin = "web"`, solo si no tenía un origen guardado). No cambia la etapa ni la asesora asignada (`src/lib/origen-web.ts`, solo en el webhook de Evolution).

## Advertencias de operación
- `chats_web_linea_admin`: los chats que entran por la línea Admin con "vengo de magilus.com" ya no nacen ocultos (`excludedFromCrm = false`): salen en el CRM y entran al público de las campañas y de las automatizaciones que mandan mensajes, como cualquier cliente.
