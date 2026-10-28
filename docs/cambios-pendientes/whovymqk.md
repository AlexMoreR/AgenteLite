## Entidades
- `ChatSendError`: cada error al enviar un texto desde Chats (negocio, chat, línea y su gateway, motivo, detalle, número único del mensaje, asesora, número de intento, origen servidor o navegador y hora). Sirve para medir; la herramienta del MCP `errores_de_envio_de_chats` lo agrupa por día, línea y motivo.

## Advertencias de operación
- `envio_de_texto_de_chats`: el texto de las asesoras se envía por la ruta `POST /api/cliente/chats/enviar` (ya no por una acción del servidor de Next.js, que se rompía en las pestañas abiertas al subir una versión nueva). Cada mensaje lleva un número único (`clientMessageId`, guardado en el `rawPayload` del mensaje): un reintento del mismo mensaje no sale dos veces. Se reintenta solo 1 o 2 veces (esperas de 1,5 y 4 s) y únicamente cuando es seguro que no salió; si el gateway agota los 25 s, queda "No se envió · Reintentar".
- `mensajes_que_no_salieron`: los textos que no salieron se guardan en el navegador de la asesora (localStorage, hasta 7 días) y siguen ahí, con su botón Reintentar, aunque recargue. Si es otro navegador u otro equipo, no aparecen.
